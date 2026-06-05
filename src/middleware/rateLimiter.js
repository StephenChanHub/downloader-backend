/**
 * 简易内存限流中间件
 * 防止暴力破解管理员密码和一次性密钥
 */

const attempts = new Map();

// 每 60 秒清理过期记录
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of attempts) {
    if (now - record.resetAt > 0) attempts.delete(key);
  }
}, 60_000).unref();

/**
 * @param {number} maxAttempts 窗口内最大请求数
 * @param {number} windowMs   时间窗口（毫秒）
 */
function rateLimiter(maxAttempts = 10, windowMs = 60_000) {
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const record = attempts.get(key);

    if (!record || now > record.resetAt) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    record.count++;
    if (record.count > maxAttempts) {
      return res.status(429).json({
        error: '请求过于频繁，请稍后再试',
        retryAfter: Math.ceil((record.resetAt - now) / 1000),
      });
    }

    next();
  };
}

module.exports = rateLimiter;
