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
 * 已知文件类型的幻数签名（Magic Bytes）映射
 * 用于二次校验，防止 MIME 类型伪造
 */
const MAGIC_BYTES = {
  pdf:  { offset: 0, bytes: Buffer.from('%PDF'),                                     label: 'PDF' },
  zip:  { offset: 0, bytes: Buffer.from([0x50, 0x4B, 0x03, 0x04]),                  label: 'ZIP' },
  rar:  { offset: 0, bytes: Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]),      label: 'RAR' },
  sevenZip: { offset: 0, bytes: Buffer.from([0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]), label: '7z' },
  gz:   { offset: 0, bytes: Buffer.from([0x1F, 0x8B]),                              label: 'GZIP' },
  bz2:  { offset: 0, bytes: Buffer.from([0x42, 0x5A, 0x68]),                        label: 'BZ2' },
  xz:   { offset: 0, bytes: Buffer.from([0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00]),      label: 'XZ' },
};

/**
 * 读取文件头部并检测真实类型（返回类型 key，未知则返回 null）
 */
async function detectFileType(filePath) {
  const fd = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8);
    await fd.read(buf, 0, 8, 0);

    // 按优先级检测（PDF 优先，因为 ZIP 的 PK 头也可能匹配到其他格式的变体）
    if (buf.slice(0, 4).equals(MAGIC_BYTES.pdf.bytes))    return 'pdf';
    if (buf.slice(0, 6).equals(MAGIC_BYTES.rar.bytes))    return 'rar';
    if (buf.slice(0, 6).equals(MAGIC_BYTES.sevenZip.bytes)) return 'sevenZip';
    if (buf.slice(0, 2).equals(MAGIC_BYTES.gz.bytes))     return 'gz';
    if (buf.slice(0, 6).equals(MAGIC_BYTES.xz.bytes))     return 'xz';
    if (buf.slice(0, 3).equals(MAGIC_BYTES.bz2.bytes))    return 'bz2';
    if (buf.slice(0, 4).equals(MAGIC_BYTES.zip.bytes))    return 'zip';
    return null;
  } finally {
    await fd.close();
  }
}

/**
 * 根据原始文件名提取无扩展名的标题
 */
function extractTitle(originalName) {
  const basename = originalName.replace(/\.(pdf|zip|rar|7z|gz|gzip|tar|bz2|bzip2|xz|tgz|tar\.gz|tar\.bz2|tar\.xz)$/i, '');
  return basename;
}

/**
 * 上传文件（支持 PDF + 压缩包）
 * POST /api/admin/files/upload
 */
async function uploadFile(req, res) {
  try {
    const { title, description } = req.body;
    const file = req.file;

    // 从请求体获取文件夹名，如果前端没传，默认归入 'public'
    const finalFolder = req.body.folder_name || 'public';

    if (!file) {
      return res.status(400).json({ error: '请选择要上传的文件' });
    }

    // 二次校验：读取文件头部幻数，验证真实类型
    const detected = await detectFileType(file.path);
    if (!detected) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: '文件类型不符：仅接受 PDF 或压缩包文件（zip/rar/7z/gz/tar/bz2/xz）' });
    }
    console.log(`[Admin] 文件类型检测: ${MAGIC_BYTES[detected].label} (${file.originalname})`);

    // 输入长度限制
    if (title && title.length > 200) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: '标题不能超过 200 个字符' });
    }
    if (description && description.length > 2000) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: '描述不能超过 2000 个字符' });
    }

    // 自动生成标题（去除扩展名）
    const finalTitle = title || extractTitle(file.originalname);

    // 将文件元数据写入 files 表（含文件夹标签）
    const [result] = await pool.query(
      `INSERT INTO files (title, description, original_name, stored_name, stored_path, size, mime_type, folder_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        finalTitle,
        description || null,
        file.originalname,
        file.filename,
        file.path,
        file.size,
        file.mimetype,
        finalFolder,
      ]
    );

    return res.status(201).json({
      id: result.insertId,
      title: finalTitle,
      original_name: file.originalname,
      size: file.size,
      mime_type: file.mimetype,
      detected_type: MAGIC_BYTES[detected].label,
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
 * 更新文件元数据（标题、描述、文件夹）
 * PATCH /api/admin/files/:id
 */
async function updateFile(req, res) {
  const { id } = req.params;
  const { title, description, folder_name } = req.body;

  try {
    // 校验至少提供一个字段
    if (title === undefined && description === undefined && folder_name === undefined) {
      return res.status(400).json({ error: '请至少提供 title、description 或 folder_name 之一' });
    }

    // 输入长度校验
    if (title !== undefined && (typeof title !== 'string' || title.length > 200)) {
      return res.status(400).json({ error: '标题不能超过 200 个字符' });
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) {
      return res.status(400).json({ error: '描述不能超过 2000 个字符' });
    }
    if (folder_name !== undefined && (typeof folder_name !== 'string' || folder_name.length > 50)) {
      return res.status(400).json({ error: '文件夹名不能超过 50 个字符' });
    }

    // 构建动态 UPDATE
    const setClauses = [];
    const params = [];

    if (title !== undefined) {
      setClauses.push('title = ?');
      params.push(title.trim() || null);
    }
    if (description !== undefined) {
      setClauses.push('description = ?');
      params.push(description.trim() || null);
    }
    if (folder_name !== undefined) {
      setClauses.push('folder_name = ?');
      params.push(folder_name.trim() || 'public');
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }

    params.push(id);

    const [result] = await pool.query(
      `UPDATE files SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '文件不存在' });
    }

    // 返回更新后的完整记录
    const [rows] = await pool.query(
      `SELECT id, title, description, original_name, stored_name,
              size, mime_type, status, folder_name, download_count, created_at, updated_at
       FROM files WHERE id = ?`,
      [id]
    );

    console.log(`[Admin] ✅ 文件 ID=${id} 已更新`);
    return res.json(rows[0]);
  } catch (err) {
    console.error('[Admin] 文件更新失败:', err.message);
    return res.status(500).json({ error: '文件更新失败' });
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

module.exports = { login, uploadFile, listFiles, updateFile, deleteFile, getStats };
