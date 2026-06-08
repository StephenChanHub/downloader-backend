const express = require('express');
const router = express.Router();
const { verifyKeyLimiter } = require('../middleware/rateLimiter');
const authController = require('../controllers/authController');

// POST /api/auth/verify-key — 用户密钥验证（限流: 1分钟内最多 5 次，超出封禁 15 分钟）
router.post('/verify-key', verifyKeyLimiter, authController.verifyKey);

module.exports = router;
