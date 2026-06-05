const multer = require('multer');
const path = require('path');
const { generateStoredName } = require('../utils/helpers');
const { STORAGE_PATH } = require('../config/init');

/**
 * Multer 上传中间件配置
 * - 仅允许 PDF 文件
 * - 单文件最大 100MB
 * - 安全重命名（UUID + 扩展名）避免中文路径与覆盖
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, STORAGE_PATH);
  },
  filename: (req, file, cb) => {
    const safeName = generateStoredName(file.originalname);
    cb(null, safeName);
  },
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('仅允许上传 PDF 文件'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
});

module.exports = upload;
