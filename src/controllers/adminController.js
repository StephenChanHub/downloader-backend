const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const pool = require('../config/db');

/**
 * 管理员登录
 * POST /api/admin/login
 */
async function login(req, res) {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: '请输入密码' });
  }

  // 去除 .env 中可能误加的引号（dotenv 16.x 通常自动剥离，此处做兜底）
  const adminPassword = (process.env.ADMIN_PASSWORD || '').replace(/^["']|["']$/g, '');

  // 环境变量缺失检测
  if (!adminPassword) {
    console.error('[Admin] ⚠️  ADMIN_PASSWORD 环境变量为空！请在 Sealos 平台设置此变量');
    return res.status(500).json({ error: '服务器配置错误：管理员密码未设置' });
  }

  console.log(`[Admin] 登录尝试 — 输入长度: ${password.length}, 期望长度: ${adminPassword.length}`);

  // 与环境变量中的 ADMIN_PASSWORD 明文比对
  if (password !== adminPassword) {
    console.log('[Admin] 密码不匹配');
    return res.status(401).json({ error: '密码错误' });
  }

  // JWT_SECRET 缺失时拒绝签发（无 fallback，防止密钥泄露导致的 Token 伪造）
  if (!process.env.JWT_SECRET) {
    console.error('[Admin] ⚠️  JWT_SECRET 环境变量为空！请在 Sealos 平台设置此变量');
    return res.status(500).json({ error: '服务器配置错误：JWT 密钥未设置' });
  }

  // 签发 JWT，有效期 24 小时
  const token = jwt.sign(
    { role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  console.log('[Admin] ✅ 登录成功');
  return res.json({ token });
}

/**
 * 上传 PDF 文件
 * POST /api/admin/files/upload
 */
async function uploadFile(req, res) {
  try {
    const { title, description } = req.body;
    const file = req.file;

    // 从请求体获取文件夹名，如果前端没传，默认归入 'public'
    const finalFolder = req.body.folder_name || 'public';

    if (!file) {
      return res.status(400).json({ error: '请选择要上传的 PDF 文件' });
    }

    // 二次校验：读取文件头部幻数，防止 MIME 类型伪造
    const fd = await fs.open(file.path, 'r');
    const buf = Buffer.alloc(4);
    await fd.read(buf, 0, 4, 0);
    await fd.close();
    if (buf.toString() !== '%PDF') {
      // 不是真 PDF，删除文件
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: '文件类型不符：仅接受真正的 PDF 文件' });
    }

    // 输入长度限制
    if (title && title.length > 200) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: '标题不能超过 200 个字符' });
    }
    if (description && description.length > 2000) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: '描述不能超过 2000 个字符' });
    }

    if (!title) {
      req.body.title = file.originalname.replace(/\.pdf$/i, '');
    }

    const finalTitle = req.body.title || file.originalname.replace(/\.pdf$/i, '');

    // 将文件元数据写入 files 表（含文件夹标签）
    const [result] = await pool.query(
      `INSERT INTO files (title, description, original_name, stored_name, stored_path, size, folder_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        finalTitle,
        description || null,
        file.originalname,
        file.filename,
        file.path,
        file.size,
        finalFolder,
      ]
    );

    return res.status(201).json({
      id: result.insertId,
      title: finalTitle,
      original_name: file.originalname,
      size: file.size,
      folder_name: finalFolder,
    });
  } catch (err) {
    console.error('[Admin] 文件上传失败:', err.message);
    return res.status(500).json({ error: '文件上传失败' });
  }
}

/**
 * 获取文件列表（含下载次数）
 * GET /api/admin/files
 */
async function listFiles(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, description, original_name, stored_name, stored_path,
              size, mime_type, status, download_count, created_at, updated_at, folder_name
       FROM files
       ORDER BY created_at DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('[Admin] 文件列表查询失败:', err.message);
    return res.status(500).json({ error: '查询失败' });
  }
}

/**
 * 删除文件（物理文件 + 数据库记录）
 * DELETE /api/admin/files/:id
 */
async function deleteFile(req, res) {
  const { id } = req.params;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 使用 FOR UPDATE 锁定行，防止并发删除竞态
    const [rows] = await conn.query(
      `SELECT stored_path FROM files WHERE id = ? FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ error: '文件不存在' });
    }

    const { stored_path } = rows[0];

    // 删除物理文件（不存在的文件不抛错）
    try {
      await fs.unlink(stored_path);
    } catch (unlinkErr) {
      if (unlinkErr.code !== 'ENOENT') {
        throw unlinkErr;
      }
      console.warn(`[Admin] 物理文件已不存在: ${stored_path}`);
    }

    // 删除数据库记录
    await conn.query(`DELETE FROM files WHERE id = ?`, [id]);

    await conn.commit();
    conn.release();

    return res.json({ success: true, message: '文件已删除' });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('[Admin] 文件删除失败:', err.message);
    return res.status(500).json({ error: '删除失败' });
  }
}

/**
 * 管理员统计仪表盘
 * GET /api/admin/stats
 */
async function getStats(req, res) {
  try {
    // 并行查询所有统计指标
    const [
      [storageRow],
      [visitorRow],
      [topFiles],
    ] = await Promise.all([
      // 指标1: 总存储空间占用 (MB)
      pool.query(
        `SELECT COALESCE(SUM(size), 0) AS total_bytes FROM files`
      ),
      // 指标2: 今日活跃访客数 + 今日下载次数
      pool.query(
        `SELECT
           COUNT(DISTINCT ip) AS unique_visitors,
           COUNT(*) AS total_downloads
         FROM download_logs
         WHERE DATE(created_at) = CURDATE()`
      ),
      // 指标3: 历史下载量 Top 10
      pool.query(
        `SELECT id, title, download_count, size
         FROM files
         WHERE status = 'active'
         ORDER BY download_count DESC
         LIMIT 10`
      ),
    ]);

    const totalBytes = Number(storageRow.total_bytes);
    const totalMB = Math.round((totalBytes / (1024 * 1024)) * 100) / 100;
    const totalGB = Math.round((totalBytes / (1024 * 1024 * 1024)) * 100) / 100;

    return res.json({
      storage: {
        bytes: totalBytes,
        mb: totalMB,
        gb: totalGB,
      },
      today: {
        unique_visitors: visitorRow.unique_visitors,
        total_downloads: visitorRow.total_downloads,
      },
      top_downloaded: topFiles.map((f) => ({
        id: f.id,
        title: f.title,
        download_count: f.download_count,
        size_mb: Math.round((Number(f.size) / (1024 * 1024)) * 100) / 100,
      })),
    });
  } catch (err) {
    console.error('[Admin] 统计数据查询失败:', err.message);
    return res.status(500).json({ error: '统计数据查询失败' });
  }
}

module.exports = { login, uploadFile, listFiles, deleteFile, getStats };
