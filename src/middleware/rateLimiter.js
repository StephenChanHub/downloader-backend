const rateLimit = require('express-rate-limit');

/**
 * 全局 API 限流：每个 IP 15 分钟内最多 1000 次请求
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
});

/**
 * 门票验证接口限流：每个 IP 1 分钟内最多 5 次试错，超出封禁 15 分钟
 */
const verifyKeyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 分钟窗口
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: '请求过于频繁，请稍后再试',
    hint: '密钥验证失败次数过多，请 15 分钟后再尝试',
  },
});

/**
 * 管理员登录限流：每个 IP 1 分钟内最多 10 次尝试
 */
const adminLoginLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
});

module.exports = { globalLimiter, verifyKeyLimiter, adminLoginLimiter };
