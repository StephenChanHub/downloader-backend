const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { generateToken, hashToken } = require('../utils/helpers');

/**
 * 用户通过一次性密钥验证，获取短期 Session
 * POST /api/auth/verify-key
 */
async function verifyKey(req, res) {
  const { key } = req.body;

  console.log(`[Auth] 收到验证请求, key 长度: ${key ? key.length : 0}`);

  if (!key) {
    return res.status(400).json({ error: '请提供访问密钥' });
  }

  // 输入长度限制（防止超长字符串攻击）
  if (key.length > 200) {
    return res.status(400).json({ error: '访问密钥格式无效' });
  }

  try {
    // 1. 扩大门票搜索范围：未使用的，或者【已使用但还没过期的】
    //    日票逻辑：只要票还在生命周期内，就能反复进入
    const [keys] = await pool.query(
      `SELECT id, key_hash, folder_name, duration_minutes, status, used_at
       FROM access_keys
       WHERE (expires_at IS NULL OR expires_at > NOW())
         AND (
           status = 'unused'
           OR
           (status = 'used' AND DATE_ADD(used_at, INTERVAL duration_minutes MINUTE) > NOW())
         )`
    );
    console.log(`[Auth] 找到 ${keys.length} 个有效密钥`);

    // 逐一使用 bcrypt.compare 比对用户输入与数据库中的哈希
    let matchedKey = null;
    for (const row of keys) {
      const match = await bcrypt.compare(key, row.key_hash);
      if (match) {
        matchedKey = row;
        console.log(`[Auth] ✅ 密钥 ID=${row.id} 匹配成功 (status: ${row.status})`);
        break;
      }
    }

    if (!matchedKey) {
      console.log('[Auth] 无匹配密钥');
      return res.status(401).json({ error: '密钥无效、已过期或不存在' });
    }

    // 2. 核心逻辑：动态计算本次下发的【剩余寿命】
    const durationMs = (matchedKey.duration_minutes || 1440) * 60 * 1000;
    let remainingDurationMs;
    let finalExpiresAt;

    if (matchedKey.status === 'unused') {
      // 场景 A：首次激活，寿命是完整的
      remainingDurationMs = durationMs;
      finalExpiresAt = new Date(Date.now() + remainingDurationMs);
    } else {
      // 场景 B：老用户重返，计算还剩多少时间（防止无限重置！）
      const usedAt = new Date(matchedKey.used_at).getTime();
      const absoluteExpireTime = usedAt + durationMs;
      remainingDurationMs = Math.max(0, absoluteExpireTime - Date.now());
      finalExpiresAt = new Date(absoluteExpireTime);
    }

    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 3. 防漏洞：只有【第一次使用】才更新状态和激活时间！
      if (matchedKey.status === 'unused') {
        await conn.query(
          `UPDATE access_keys SET status = 'used', used_at = NOW() WHERE id = ?`,
          [matchedKey.id]
        );
      }

      // 无论新老用户，都写入一条新的会话记录
      await conn.query(
        `INSERT INTO sessions (token_hash, type, related_key_id, expires_at, folder_name)
         VALUES (?, 'user', ?, ?, ?)`,
        [tokenHash, matchedKey.id, finalExpiresAt, matchedKey.folder_name || 'public']
      );

      await conn.commit();
      conn.release();
      console.log('[Auth] ✅ 事务提交成功');
    } catch (err) {
      await conn.rollback();
      conn.release();
      console.error('[Auth] 事务失败 — 完整错误:', err);
      return res.status(500).json({ error: '服务器内部错误' });
    }

    // 4. 下发 Cookie，寿命严格等于票的剩余时间
    res.cookie('session_token', rawToken, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: remainingDurationMs,
    });

    console.log('[Auth] ✅ 验证成功，返回 Cookie');
    return res.json({
      success: true,
      message: matchedKey.status === 'unused'
        ? '验证成功，密钥已激活'
        : '欢迎回来，门票依然有效',
      expires_at: finalExpiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[Auth] 密钥验证失败 — 完整错误:');
    console.error('  message:', err.message);
    console.error('  code:', err.code);
    console.error('  sqlMessage:', err.sqlMessage);
    console.error('  stack:', err.stack);
    const detail = process.env.NODE_ENV === 'development' ? err.message : undefined;
    return res.status(500).json({ error: '服务器内部错误', detail });
  }
}

module.exports = { verifyKey };
