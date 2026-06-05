const express = require('express');
const router = express.Router();
const userSessionAuth = require('../middleware/userSessionAuth');
const filesController = require('../controllers/filesController');

// GET /api/files — 获取可下载文件列表（需有效 Session）
router.get('/', userSessionAuth, filesController.listFiles);

// GET /api/files/:id/download — 下载指定文件（需有效 Session）
router.get('/:id/download', userSessionAuth, filesController.downloadFile);

module.exports = router;
