const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

/**
 * 用户获取可下载文件列表（不暴露存储路径）
 * GET /api/files
 */
async function listFiles(req, res) {
  try {
    // 读取当前 Session 绑定的专属文件夹名
    const userFolder = req.currentSession.folder_name || 'public';

    // 核心：按 folder_name 过滤，只返回该用户专属文件夹内的文件
    const [rows] = await pool.query(
      `SELECT id, title, description, size, mime_type, created_at, folder_name
       FROM files
       WHERE status = 'active' AND folder_name = ?
       ORDER BY created_at DESC`,
      [userFolder]
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
    // 查询文件记录获取真实存储路径（同时校验 folder_name 防止越权）
    const [rows] = await pool.query(
      `SELECT id, original_name, stored_name, stored_path, mime_type
       FROM files
       WHERE id = ? AND status = 'active' AND folder_name = ?`,
      [id, session.folder_name || 'public']
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

    // 获取文件大小（用于 Range 支持）
    let fileSize;
    try {
      const stat = await fs.promises.stat(resolvedPath);
      fileSize = stat.size;
    } catch {
      return res.status(404).json({ error: '文件不存在于服务器' });
    }

    // 异步记录下载日志 + 更新计数（不阻塞文件流输出，仅全量下载时记录）
    const clientIp = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || null;

    // 解析 Range 请求头（格式: bytes=start-end）
    const range = req.headers.range;
    let start = 0;
    let end = fileSize - 1;
    let isRangeRequest = false;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      start = parseInt(parts[0], 10) || 0;
      end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      // 校验 Range 合法性
      if (start >= fileSize || end >= fileSize || start > end) {
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.status(416).json({ error: '请求范围不合法' });
      }

      isRangeRequest = true;
    }

    // 仅在全量下载（非 Range）时记录日志和更新计数
    if (!isRangeRequest) {
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
    }

    // 设置响应头
    const encodedFilename = encodeURIComponent(file.original_name);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodedFilename}`
    );
    res.setHeader('Content-Type', file.mime_type || 'application/pdf');
    res.setHeader('Accept-Ranges', 'bytes');

    if (isRangeRequest) {
      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunkSize);
    } else {
      res.setHeader('Content-Length', fileSize);
    }

    // 流式输出文件内容（支持 Range 分段读取）
    // highWaterMark: 1MB 缓冲区，大幅减少大文件 I/O 操作次数
    const readStream = fs.createReadStream(resolvedPath, {
      start,
      end,
      highWaterMark: 1024 * 1024, // 1MB 块大小
    });

    // 监听下载完成/中断，清理资源
    res.on('close', () => {
      if (!readStream.destroyed) readStream.destroy();
    });

    readStream.on('error', (err) => {
      console.error(`[Files] 文件流读取失败: ${err.message}`);
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
