const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/verify-key — 用户通过一次性密钥验证
router.post('/verify-key', authController.verifyKey);

module.exports = router;
