const pool = require('../config/db');
const { hashToken } = require('../utils/helpers');

/**
 * 普通用户 Session 鉴权中间件
 * 读取 Cookie 中的 session_token，比对数据库 sessions 表
 */
async function userSessionAuth(req, res, next) {
  const rawToken = req.cookies?.session_token;

  if (!rawToken) {
    return res.status(401).json({ error: '未登录，请先使用访问密钥验证' });
  }

  // 将 Cookie 中的原始 Token 哈希后，与数据库中的 token_hash 比对
  const tokenHash = hashToken(rawToken);

  try {
    const [rows] = await pool.query(
      `SELECT * FROM sessions WHERE token_hash = ? AND expires_at > NOW()`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: '会话已过期或无效，请重新验证' });
    }

    const session = rows[0];

    // 更新最后活跃时间
    await pool.query(
      `UPDATE sessions SET last_seen_at = NOW() WHERE id = ?`,
      [session.id]
    );

    // 将会话信息挂载到 req 上，供后续控制器使用
    req.currentSession = session;
    next();
  } catch (err) {
    console.error('[SessionAuth] 数据库查询失败 — 完整错误:');
    console.error('  message:', err.message);
    console.error('  code:', err.code);
    return res.status(500).json({ error: '服务器内部错误' });
  }
}

module.exports = userSessionAuth;
