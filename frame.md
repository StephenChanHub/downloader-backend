
---

### 给 Claude 的上下文与指令清单 (直接复制以下内容)

**【项目背景】**
我需要你帮我使用 Node.js + Express 编写一个“极简私有 PDF 文件分发系统”的后端代码。
核心业务逻辑：管理员通过后台上传 PDF 到服务器私有目录；普通用户通过验证“一次性密钥”获取短期 Session（30分钟），在有效期内可无限制下载全部 PDF。
存储说明：代码运行在带有持久卷（PVC）的云端容器中，PDF 物理文件必须保存在 `/home/devbox/project/storage/pdfs`。不使用云对象存储。

**【技术栈与依赖要求】**

* 框架：`express`
* 数据库：`mysql2` (配合 `Promise` 使用，原生 SQL 操作，不需要复杂的 ORM)
* 文件上传：`multer`
* 安全/认证：`bcrypt` (用于比对密钥哈希)，`jsonwebtoken` (用于管理员鉴权)，`cookie-parser` (用于普通用户短期 Session)
* 跨域与基础保护：`cors`, `helmet`

**【目录结构要求】**
请按照以下结构生成代码，保持逻辑分离：

```text
/src
  ├── config/        # 环境变量与配置 (数据库连接池等)
  ├── middleware/    # 鉴权中间件、multer上传中间件
  ├── controllers/   # 核心业务逻辑
  ├── routes/        # 路由定义
  ├── utils/         # 工具函数 (如文件哈希、安全重命名等)
  └── index.js       # 入口文件

```

**【工作流与 API 清单拆解 (请逐一实现)】**

#### Phase 1: 基础架构与配置 (`/config`)

1. **数据库连接池**：使用 `mysql2/promise` 初始化连接池，读取 `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`。
2. **初始化存储目录**：在服务启动时，使用 `fs.promises.mkdir` 检查并创建 `/home/devbox/project/storage/pdfs` 目录，确保上传路径存在。

#### Phase 2: 核心中间件开发 (`/middleware`)

1. **`adminAuth.js`**：校验请求头中的 JWT Token 是否有效，拦截非管理员请求。
2. **`userSessionAuth.js`**：
* 读取请求携带的 Cookie (`session_token`)。
* 查询数据库 `sessions` 表，检查 Token 是否存在且 `expires_at` 大于当前时间。
* 如果过期或无效，返回 401 状态码；如果有效，更新 `last_seen_at` 并放行。


3. **`upload.js`**：配置 `multer`，限制文件类型仅为 `application/pdf`，限制单文件大小（如 100MB）。使用随机字符串（UUID 或时间戳+随机数）对文件进行安全重命名，避免中文路径和覆盖。

#### Phase 3: 管理员接口 (`/routes/admin.js`)

1. **POST `/api/admin/login**`
* 接收密码，验证环境变量中的 `ADMIN_PASSWORD`。
* 成功则签发 JWT Token（有效期 24h）。


2. **POST `/api/admin/files/upload**` (需经过 `adminAuth` 和 `upload` 中间件)
* 接收表单：文件本体、`title`、`description`。
* 将 `title`, `description`, `original_name`, `stored_name`, `stored_path`, `size` 写入 `files` 表。


3. **GET `/api/admin/files**`
* 查询 `files` 表，返回所有文件列表（包含下载次数统计）。


4. **DELETE `/api/admin/files/:id**`
* 查询库中文件的 `stored_path`。
* 执行 `fs.promises.unlink` 删除物理文件。
* 删除 `files` 表中的对应记录。



#### Phase 4: 用户鉴权接口 (`/routes/auth.js`)

1. **POST `/api/auth/verify-key**`
* 接收用户输入的明文 `key`。
* 在 `access_keys` 表中查询是否有匹配的哈希，且 `status` 为 `unused`。
* 如果有效：
1. 开启数据库事务。
2. 将该 key 的状态更新为 `used`，记录 `used_at`。
3. 生成一个随机的 `session_token`。
4. 在 `sessions` 表中写入记录，`expires_at` 设为当前时间 + 30 分钟。
5. 提交事务。


* 将 `session_token` 以 `HttpOnly`, `SameSite=Strict` 的 Cookie 形式返回给客户端。



#### Phase 5: 用户文件与下载接口 (`/routes/files.js`)

1. **GET `/api/files**` (需经过 `userSessionAuth` 中间件)
* 查询 `files` 表中 `status = 'active'` 的文件。
* **注意**：绝对不要向前端返回 `stored_name` 或 `stored_path`，只返回 `id`, `title`, `description`, `size`, `created_at`。


2. **GET `/api/files/:id/download**` (需经过 `userSessionAuth` 中间件)
* 接收文件 ID，查询 `files` 表获取真实的 `stored_path`。
* 安全检查：如果文件不存在返回 404。
* 数据库异步操作：向 `download_logs` 表插入一条下载记录（包含 `session_id`, `file_id`, `ip`），并对 `files.download_count` 进行 `+1` 操作。
* **流式下载核心逻辑**：
* 设置响应头：`Content-Disposition: attachment; filename="URL编码后的原文件名.pdf"`
* 设置响应头：`Content-Type: application/pdf`
* 使用 `fs.createReadStream(stored_path).pipe(res)` 将文件流式输出给客户端。





**【输出要求】**
请一步步输出代码。你可以先从 Phase 1 和 Phase 2 的基础搭建开始，给出具体代码后停顿，等我确认后再继续输出后续的业务控制器代码。请确保在关键的流式下载和安全保护处加上中文注释。

---