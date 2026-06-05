const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');
const upload = require('../middleware/upload');
const adminController = require('../controllers/adminController');

// POST /api/admin/login — 管理员登录
router.post('/login', adminController.login);

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

module.exports = router;
