为什么前端会“什么文件都没有”！

数据库中你建的字段名叫 `folder_name`，而我上一轮给你的代码里拼写的全是 `category`，那么后端的 SQL 查询在执行时就会因为“找不到 `category` 列”而直接报错崩溃（500 错误）。前端拿不到数据，自然就渲染出一个空列表。

我们需要把这三个控制器文件中的 `category` 精准替换为你的实际字段名 `folder_name`。

请再次复制以下修改后的代码进行覆盖：

### 🔪 第一处：修复门票传递（`src/controllers/authController.js`）

覆盖 `verifyKey` 函数。现在它会正确读取和写入 `folder_name` 字段：

```javascript
async function verifyKey(req, res) {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: "请提供访问密钥" });

  try {
    // 1. 查出门票，读取 folder_name
    const [keys] = await pool.query(
      `SELECT id, key_hash, folder_name FROM access_keys
       WHERE status = 'unused' AND (expires_at IS NULL OR expires_at > NOW())`,
    );

    let matchedKey = null;
    for (const row of keys) {
      const match = await bcrypt.compare(key, row.key_hash);
      if (match) {
        matchedKey = row;
        break;
      }
    }

    if (!matchedKey)
      return res.status(401).json({ error: "密钥无效或已被使用" });

    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `UPDATE access_keys SET status = 'used', used_at = NOW() WHERE id = ?`,
        [matchedKey.id],
      );

      // 2. 核心修复：将会话的 folder_name 设为门票的 folder_name
      await conn.query(
        `INSERT INTO sessions (token_hash, type, related_key_id, expires_at, folder_name)
         VALUES (?, 'user', ?, ?, ?)`,
        [
          tokenHash,
          matchedKey.id,
          expiresAt,
          matchedKey.folder_name || "public",
        ],
      );

      await conn.commit();
      conn.release();
    } catch (err) {
      await conn.rollback();
      conn.release();
      throw err;
    }

    res.cookie("session_token", rawToken, {
      httpOnly: true,
      sameSite: "none",
      secure: true,
      maxAge: 30 * 60 * 1000,
    });

    return res.json({
      success: true,
      message: "验证成功，已进入专属空间",
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("[Auth] 验证失败:", err.message);
    return res.status(500).json({ error: "服务器内部错误" });
  }
}
```

---

### 🔪 第二处：修复用户查询（`src/controllers/filesController.js`）

覆盖 `listFiles` 函数。现在它会用 `folder_name` 去过滤文件：

```javascript
async function listFiles(req, res) {
  try {
    // 读取当前 Session 绑定的专属文件夹名
    const userFolder = req.currentSession.folder_name || "public";

    // 核心修复：加入 folder_name = ? 的过滤条件
    const [rows] = await pool.query(
      `SELECT id, title, description, size, created_at, folder_name
       FROM files
       WHERE status = 'active' AND folder_name = ?
       ORDER BY created_at DESC`,
      [userFolder],
    );

    return res.json(rows);
  } catch (err) {
    console.error("[Files] 文件列表查询失败:", err.message);
    return res.status(500).json({ error: "查询失败" });
  }
}
```

---

### 🔪 第三处：恢复管理员查询与上传（`src/controllers/adminController.js`）

覆盖 `listFiles` 和 `uploadFile` 两个函数：

```javascript
// 1. 管理员查询文件（查看全部，返回 folder_name）
async function listFiles(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, description, original_name, stored_name, stored_path,
              size, mime_type, status, download_count, created_at, updated_at, folder_name
       FROM files
       ORDER BY created_at DESC`,
    );
    return res.json(rows);
  } catch (err) {
    console.error("[Admin] 文件列表查询失败:", err.message);
    return res.status(500).json({ error: "查询失败" });
  }
}

// 2. 管理员上传文件
async function uploadFile(req, res) {
  try {
    // 接收前端传过来的 folder_name
    const { title, description, folder_name } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "请选择文件" });

    const finalTitle = title || file.originalname.replace(/\.pdf$/i, "");
    const finalFolder = folder_name || "public";

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
      ],
    );

    return res.status(201).json({
      id: result.insertId,
      title: finalTitle,
      folder_name: finalFolder,
      size: file.size,
    });
  } catch (err) {
    console.error("[Admin] 文件上传失败:", err.message);
    return res.status(500).json({ error: "文件上传失败" });
  }
}
```
