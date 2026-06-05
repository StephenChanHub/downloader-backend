const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

/**
 * 用户获取可下载文件列表（不暴露存储路径）
 * GET /api/files
 */
async function listFiles(req, res) {
  try {
    // 仅返回 id, title, description, size, created_at
    // 绝不向前端暴露 stored_name 或 stored_path
    const [rows] = await pool.query(
      `SELECT id, title, description, size, created_at
       FROM files
       WHERE status = 'active'
       ORDER BY created_at DESC`
    );

    return res.json(rows);
  } catch (err) {
    console.error('[Files] 文件列表查询失败:', err.message);
    return res.status(500).json({ error: '查询失败' });
  }
}

/**
 * 用户下载文件（流式传输）
 * GET /api/files/:id/download
 */
async function downloadFile(req, res) {
  const { id } = req.params;
  const session = req.currentSession;

  try {
    // 查询文件记录获取真实存储路径
    const [rows] = await pool.query(
      `SELECT id, original_name, stored_name, stored_path, mime_type
       FROM files
       WHERE id = ? AND status = 'active'`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: '文件不存在' });
    }

    const file = rows[0];

    // 安全检查：确保文件在允许的存储目录内（防止路径穿越）
    const resolvedPath = path.resolve(file.stored_path);
    // 使用与 init.js 相同的存储路径（支持环境变量覆盖）
    const allowedBase = path.resolve(
      process.env.STORAGE_PATH || '/home/devbox/project/storage/pdfs'
    );
    if (!resolvedPath.startsWith(allowedBase)) {
      console.error(`[Files] 路径穿越攻击检测: ${file.stored_path}`);
      return res.status(403).json({ error: '禁止访问' });
    }

    // 检查物理文件是否存在
    try {
      await fs.promises.access(resolvedPath, fs.constants.R_OK);
    } catch {
      return res.status(404).json({ error: '文件不存在于服务器' });
    }

    // 异步记录下载日志 + 更新计数（不阻塞文件流输出）
    const clientIp = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || null;

    pool.query(
      `INSERT INTO download_logs (session_id, file_id, ip, user_agent)
       VALUES (?, ?, ?, ?)`,
      [session.id, file.id, clientIp, userAgent]
    ).catch(err => console.error('[Files] 下载日志记录失败:', err.message));

    pool.query(
      `UPDATE files SET download_count = download_count + 1 WHERE id = ?`,
      [file.id]
    ).catch(err => console.error('[Files] 下载计数更新失败:', err.message));

    pool.query(
      `UPDATE sessions SET download_count = download_count + 1 WHERE id = ?`,
      [session.id]
    ).catch(err => console.error('[Files] 会话下载计数更新失败:', err.message));

    // 设置响应头
    // 使用 encodeURIComponent 处理中文文件名
    const encodedFilename = encodeURIComponent(file.original_name);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader('Content-Type', file.mime_type || 'application/pdf');

    // 流式输出文件内容给客户端
    const readStream = fs.createReadStream(resolvedPath);

    readStream.on('error', (err) => {
      console.error(`[Files] 文件流读取失败: ${err.message}`);
      // 响应头已发送，只能终止连接
      if (!res.headersSent) {
        res.status(500).json({ error: '文件读取失败' });
      } else {
        res.end();
      }
    });

    readStream.pipe(res);
  } catch (err) {
    console.error('[Files] 下载处理失败:', err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: '下载失败' });
    }
  }
}

module.exports = { listFiles, downloadFile };
