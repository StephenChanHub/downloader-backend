const fs = require('fs').promises;
const path = require('path');

// 云容器默认路径，可通过 STORAGE_PATH 环境变量覆盖（本地开发用）
const STORAGE_PATH = process.env.STORAGE_PATH || '/home/devbox/project/storage/pdfs';

async function initStorage() {
  try {
    await fs.mkdir(STORAGE_PATH, { recursive: true });
    console.log(`[存储] PDF 存储目录已就绪: ${STORAGE_PATH}`);
  } catch (err) {
    // 不抛出异常 — 存储目录创建失败不应阻止服务启动
    // 上传/下载接口会在实际操作时返回明确错误
    console.error(`[存储] ⚠️  无法创建存储目录 ${STORAGE_PATH}: ${err.message}`);
    console.error(`[存储] 上传功能将不可用，请检查 PVC 挂载或目录权限`);
  }
}

module.exports = { initStorage, STORAGE_PATH };
