const crypto = require('crypto');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * 生成随机会话 Token（原始值，存入 Cookie）
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 对 Token 进行 SHA-256 哈希（存入数据库 sessions.token_hash）
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * 生成安全存储文件名：UUID + 原始扩展名
 * 避免中文路径、特殊字符和文件名冲突
 */
function generateStoredName(originalName) {
  const ext = path.extname(originalName) || '.pdf';
  return `${uuidv4()}${ext}`;
}

module.exports = { generateToken, hashToken, generateStoredName };
