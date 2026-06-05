const bcrypt = require('bcrypt');
const pool = require('../config/db');
const { generateToken, hashToken } = require('../utils/helpers');

/**
 * 用户通过一次性密钥验证，获取短期 Session
 * POST /api/auth/verify-key
 */
async function verifyKey(req, res) {
  const { key } = req.body;

  if (!key) {
    return res.status(400).json({ error: '请提供访问密钥' });
  }

  try {
    // 查询所有状态为 unused 的密钥（且未超过绝对过期时间）
    const [keys] = await pool.query(
      `SELECT id, key_hash FROM access_keys
       WHERE status = 'unused'
         AND (expires_at IS NULL OR expires_at > NOW())`
    );

    // 逐一使用 bcrypt.compare 比对用户输入与数据库中的哈希
    let matchedKey = null;
    for (const row of keys) {
      const match = await bcrypt.compare(key, row.key_hash);
      if (match) {
        matchedKey = row;
        break;
      }
    }

    if (!matchedKey) {
      return res.status(401).json({ error: '访问密钥无效或已被使用' });
    }

    // 生成 Session Token
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 分钟有效期

    const conn = await pool.getConnection();

    try {
      // 开启事务：原子性地消耗密钥 + 创建会话
      await conn.beginTransaction();

      // 将密钥标记为已使用
      await conn.query(
        `UPDATE access_keys SET status = 'used', used_at = NOW() WHERE id = ?`,
        [matchedKey.id]
      );

      // 创建会话记录
      await conn.query(
        `INSERT INTO sessions (token_hash, type, related_key_id, expires_at)
         VALUES (?, 'user', ?, ?)`,
        [tokenHash, matchedKey.id, expiresAt]
      );

      await conn.commit();
      conn.release();
    } catch (err) {
      await conn.rollback();
      conn.release();
      console.error('[Auth] 事务失败:', err.message);
      return res.status(500).json({ error: '服务器内部错误' });
    }

    // 将 session_token 以 HttpOnly Cookie 形式返回
    // 生产环境（HTTPS）启用 secure 标志；前后端同属 sealosgzg.site，SameSite=Strict 可正常工作
    res.cookie('session_token', rawToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 60 * 1000, // 30 分钟
    });

    return res.json({
      success: true,
      message: '验证成功，会话有效期为 30 分钟',
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('[Auth] 密钥验证失败:', err.message);
    return res.status(500).json({ error: '服务器内部错误' });
  }
}

module.exports = { verifyKey };
