const express = require('express');
const router = express.Router();
const rateLimiter = require('../middleware/rateLimiter');
const authController = require('../controllers/authController');

// POST /api/auth/verify-key — 用户密钥验证（限流: 1分钟内最多 10 次尝试）
router.post('/verify-key', rateLimiter(10, 60_000), authController.verifyKey);

module.exports = router;
