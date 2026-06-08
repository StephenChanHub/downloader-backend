const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const upload = require('../middleware/upload');
const { adminLoginLimiter } = require('../middleware/rateLimiter');
const adminController = require('../controllers/adminController');

// POST /api/admin/login — 管理员登录（限流: 1分钟内最多 5 次）
router.post('/login', adminLoginLimiter, adminController.login);

// POST /api/admin/files/upload — 上传 PDF（需管理员认证 + multer 文件处理）
router.post(
  '/files/upload',
  adminAuth,
  upload.single('file'),
  adminController.uploadFile
);

// GET /api/admin/files — 获取所有文件列表
router.get('/files', adminAuth, adminController.listFiles);

// DELETE /api/admin/files/:id — 删除文件
router.delete('/files/:id', adminAuth, adminController.deleteFile);

// GET /api/admin/stats — 仪表盘统计数据
router.get('/stats', adminAuth, adminController.getStats);

module.exports = router;
