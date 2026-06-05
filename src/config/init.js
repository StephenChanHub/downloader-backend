const fs = require('fs').promises;
const path = require('path');

// 云容器默认路径，可通过 STORAGE_PATH 环境变量覆盖（本地开发用）
const STORAGE_PATH = process.env.STORAGE_PATH || '/home/devbox/project/storage/pdfs';

async function initStorage() {
  try {
    await fs.mkdir(STORAGE_PATH, { recursive: true });
    console.log(`[存储] PDF 存储目录已就绪: ${STORAGE_PATH}`);
  } catch (err) {
    console.error(`[存储] 无法创建存储目录 ${STORAGE_PATH}:`, err.message);
    throw err;
  }
}

module.exports = { initStorage, STORAGE_PATH };
