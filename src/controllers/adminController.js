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

  // 与环境变量中的 ADMIN_PASSWORD 明文比对
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: '密码错误' });
  }

  // 签发 JWT，有效期 24 小时
  const token = jwt.sign(
    { role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

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

    if (!file) {
      return res.status(400).json({ error: '请选择要上传的 PDF 文件' });
    }

    if (!title) {
      // 如果没有填写标题，回退使用原始文件名（不含扩展名）
      req.body.title = file.originalname.replace(/\.pdf$/i, '');
    }

    const finalTitle = req.body.title || file.originalname.replace(/\.pdf$/i, '');

    // 将文件元数据写入 files 表
    const [result] = await pool.query(
      `INSERT INTO files (title, description, original_name, stored_name, stored_path, size)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        finalTitle,
        description || null,
        file.originalname,
        file.filename,
        file.path,
        file.size,
      ]
    );

    return res.status(201).json({
      id: result.insertId,
      title: finalTitle,
      original_name: file.originalname,
      size: file.size,
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
              size, mime_type, status, download_count, created_at, updated_at
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
    // 查询文件记录以获取物理路径
    const [rows] = await conn.query(
      `SELECT stored_path FROM files WHERE id = ?`,
      [id]
    );

    if (rows.length === 0) {
      conn.release();
      return res.status(404).json({ error: '文件不存在' });
    }

    const { stored_path } = rows[0];

    // 开启事务：先删物理文件，再删数据库记录
    await conn.beginTransaction();

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

module.exports = { login, uploadFile, listFiles, deleteFile };
