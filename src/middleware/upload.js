const multer = require('multer');
const path = require('path');
const { generateStoredName } = require('../utils/helpers');
const { STORAGE_PATH } = require('../config/init');

/**
 * 允许上传的文件 MIME 类型
 * - PDF 文档
 * - 常见压缩包格式
 */
const ALLOWED_MIMES = new Set([
  // PDF
  'application/pdf',
  // ZIP
  'application/zip',
  'application/x-zip-compressed',
  // RAR
  'application/vnd.rar',
  'application/x-rar-compressed',
  // 7-Zip
  'application/x-7z-compressed',
  // GZIP
  'application/gzip',
  'application/x-gzip',
  // TAR
  'application/x-tar',
  // BZIP2
  'application/x-bzip2',
  // XZ
  'application/x-xz',
  // 通用二进制流（部分浏览器对压缩包使用此类型）
  'application/octet-stream',
]);

/**
 * 允许的扩展名（二次校验兜底）
 */
const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.zip',
  '.rar',
  '.7z',
  '.gz',
  '.gzip',
  '.tar',
  '.bz2',
  '.bzip2',
  '.xz',
  '.tgz',
  '.tar.gz',
  '.tar.bz2',
  '.tar.xz',
]);

/**
 * Multer 上传中间件配置
 * - 支持 PDF + 常见压缩包格式
 * - 单文件最大 500MB
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
  const ext = path.extname(file.originalname).toLowerCase();

  // 对 .tar.gz 等复合扩展名做特殊处理
  const basename = file.originalname.toLowerCase();
  let effectiveExt = ext;
  if (basename.endsWith('.tar.gz')) effectiveExt = '.tar.gz';
  else if (basename.endsWith('.tar.bz2')) effectiveExt = '.tar.bz2';
  else if (basename.endsWith('.tar.xz')) effectiveExt = '.tar.xz';

  if (ALLOWED_EXTENSIONS.has(effectiveExt) || ALLOWED_MIMES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('仅允许上传 PDF 或压缩包文件（zip/rar/7z/gz/tar/bz2/xz）'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
  },
});

module.exports = upload;
