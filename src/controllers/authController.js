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
    // 提前生成 Session Token（事务中只使用哈希值）
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    console.log('[Auth] 开启事务（FOR UPDATE 防并发）...');
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();

      // SELECT ... FOR UPDATE 锁定所有未使用密钥行，防止两个并发请求消费同一密钥
      console.log('[Auth] 查询未使用密钥（FOR UPDATE）...');
      const [keys] = await conn.query(
        `SELECT id, key_hash, folder_name FROM access_keys
         WHERE status = 'unused'
           AND (expires_at IS NULL OR expires_at > NOW())
         FOR UPDATE`
      );
      console.log(`[Auth] 找到 ${keys.length} 个未使用密钥`);

      // 逐一使用 bcrypt.compare 比对用户输入与数据库中的哈希
      let matchedKey = null;
      for (const row of keys) {
        console.log(`[Auth] 比对密钥 ID=${row.id}, hash=${row.key_hash.substring(0, 10)}...`);
        const match = await bcrypt.compare(key, row.key_hash);
        if (match) {
          matchedKey = row;
          console.log(`[Auth] ✅ 密钥 ID=${row.id} 匹配成功`);
          break;
        }
      }

      if (!matchedKey) {
        await conn.rollback();
        conn.release();
        console.log('[Auth] 无匹配密钥');
        return res.status(401).json({ error: '访问密钥无效或已被使用' });
      }

      // 将密钥标记为已使用
      await conn.query(
        `UPDATE access_keys SET status = 'used', used_at = NOW() WHERE id = ?`,
        [matchedKey.id]
      );

      // 创建会话记录（带上文件夹隔离信息）
      await conn.query(
        `INSERT INTO sessions (token_hash, type, related_key_id, folder_name, expires_at)
         VALUES (?, 'user', ?, ?, ?)`,
        [tokenHash, matchedKey.id, matchedKey.folder_name || 'public', expiresAt]
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

    // 将 session_token 以 HttpOnly Cookie 形式返回
    // sameSite=none 允许跨子域传递（wmrazineousa ↔ cjdfnwwofgct）
    // secure=true 是 sameSite=none 的强制要求（生产环境为 HTTPS）
    res.cookie('session_token', rawToken, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: 30 * 60 * 1000,
    });

    console.log('[Auth] ✅ 验证成功，返回 Cookie');
    return res.json({
      success: true,
      message: '验证成功，会话有效期为 30 分钟',
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    // 打印完整错误对象，包含 code、sqlMessage、stack 等所有诊断信息
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
