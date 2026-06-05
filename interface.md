# PDF 私有分发系统 — 前端接口文档

---

## 目录

1. [系统概述](#1-系统概述)
2. [项目架构](#2-项目架构)
3. [核心工作流](#3-核心工作流)
4. [通用约定](#4-通用约定)
5. [管理员接口](#5-管理员接口)
6. [用户鉴权接口](#6-用户鉴权接口)
7. [用户文件接口](#7-用户文件接口)
8. [Session 机制详解](#8-session-机制详解)
9. [错误码参考](#9-错误码参考)
10. [前端对接 CheckList](#10-前端对接-checklist)

---

## 1. 系统概述

本系统是一个**极简私有 PDF 文件分发系统**。核心业务:

```
管理员 —(上传)—> PDF 文件 —(存储)—> 服务器私有目录
                                    |
用户 —(一次性密钥)—> 短期 Session —(30分钟内)—> 浏览 & 下载 PDF
```

- **管理员**：通过后台登录 → 上传/管理 PDF 文件
- **普通用户**：输入一次性密钥 → 获得 30 分钟 Session → 浏览列表 → 下载 PDF

---

## 2. 项目架构

### 2.1 部署拓扑

```
┌──────────────────────────────────────────────────────────────┐
│  前端 (React/Vue/...)                 后端 (Express API)      │
│  端口: 3000                            端口: 8080              │
│                                                                   │
│  公网: https://wmrazineousa.sealosgzg.site                       │
│  内网: http://ptedownload.ns-lnn76r5i.svc.cluster.local:3000     │
│                                                                   │
│  公网: https://cjdfnwwofgct.sealosgzg.site                       │
│  内网: http://downloader-backend.ns-lnn76r5i:8080                │
│                                                                   │
│  同站点: 均为 *.sealosgzg.site → SameSite=Strict Cookie 可用      │
└──────────────────────────────────────────────────────────────┘
```

> **跨域说明**：前后端部署在不同子域（`wmrazineousa` vs `cjdfnwwofgct`），属于**同站点跨源**（same-site cross-origin）。后端 CORS 已配置 `credentials: true` + 指定 Origin 白名单；Cookie 使用 `SameSite=Strict` 在此拓扑下正常工作。

### 2.2 目录结构

```text
src/
├── config/
│   ├── db.js              # MySQL2 连接池 (mysql2/promise)
│   └── init.js            # 存储目录初始化
├── middleware/
│   ├── adminAuth.js       # JWT 管理员鉴权中间件
│   ├── userSessionAuth.js # Cookie Session 用户鉴权中间件
│   └── upload.js          # Multer PDF 上传中间件
├── controllers/
│   ├── adminController.js # 管理员业务逻辑
│   ├── authController.js  # 用户鉴权业务逻辑
│   └── filesController.js # 用户文件业务逻辑
├── routes/
│   ├── admin.js           # /api/admin/*
│   ├── auth.js            # /api/auth/*
│   └── files.js           # /api/files/*
├── utils/
│   └── helpers.js         # Token 生成/哈希、文件名安全化
└── index.js               # Express 入口
```

### 2.3 技术栈

| 层次       | 技术                    | 用途                 |
| ---------- | ----------------------- | -------------------- |
| 框架       | Express 4.x             | HTTP 服务            |
| 数据库     | MySQL2 (Promise)        | 原生 SQL 操作        |
| 文件上传   | Multer                  | PDF 表单上传         |
| 密码哈希   | bcrypt                  | 一次性密钥校验       |
| 管理员鉴权 | jsonwebtoken (JWT)      | 24h 管理员 Token     |
| 用户鉴权   | cookie-parser + SHA-256 | 30min Session Cookie |
| 安全       | helmet + cors           | 安全头 + 跨域        |

### 2.4 数据库表

| 表名            | 用途                                               |
| --------------- | -------------------------------------------------- |
| `files`         | PDF 文件元数据（标题、路径、大小、下载次数）       |
| `access_keys`   | 一次性访问密钥（bcrypt 哈希存储，用完即标记 used） |
| `sessions`      | 短期用户会话（30min 过期，SHA-256 哈希存储）       |
| `download_logs` | 下载审计日志（会话ID、文件ID、IP、UA）             |

---

## 3. 核心工作流

### 3.1 管理员工作流

```
┌──────────┐    POST /api/admin/login     ┌──────────┐
│  管理员   │ ─────────────────────────────> │  后端     │
│ (浏览器)  │ <───────────────────────────── │          │
└──────────┘    { token: "eyJ..." }        └──────────┘
      │
      │  Authorization: Bearer eyJ...
      │
      ├── POST /api/admin/files/upload  ──> 上传 PDF (multipart/form-data)
      ├── GET  /api/admin/files         ──> 查看全部文件列表
      └── DELETE /api/admin/files/:id   ──> 删除文件
```

**流程说明**：

1. 管理员在登录页输入密码
2. 后端验证 `ADMIN_PASSWORD` 环境变量，签发 24h 有效期 JWT
3. 前端将 JWT 存入 `localStorage`，后续请求带 `Authorization: Bearer <token>` 头
4. 上传 PDF 时使用 `multipart/form-data`，字段名 `file`（文件本体）、`title`、`description`
5. 文件列表返回全部字段（含 `stored_path`），方便管理员管理
6. 删除操作为事务性：先删物理文件，再删数据库记录

### 3.2 用户工作流

```
┌──────────┐    POST /api/auth/verify-key    ┌──────────┐
│  用户     │ ───────────────────────────────> │  后端     │
│ (浏览器)  │ <─────────────────────────────── │          │
└──────────┘  Set-Cookie: session_token=xxx    └──────────┘
      │         { success: true, expires_at }
      │
      │  浏览器自动携带 Cookie: session_token=xxx
      │
      ├── GET /api/files              ──> 获取可下载文件列表（不含路径）
      └── GET /api/files/:id/download ──> 流式下载 PDF
```

**流程说明**：

1. 用户输入一次性访问密钥，点击"验证"
2. 后端 bcrypt 比对密钥哈希 → 标记密钥为已使用 → 创建 30min Session → 通过 `Set-Cookie` 返回
3. 浏览器自动保存 Cookie（`httpOnly`、`sameSite=strict`），后续请求自动携带
4. 用户浏览文件列表（仅返回安全字段）
5. 点击下载 → 浏览器触发 `Content-Disposition: attachment` 下载行为
6. 30 分钟后 Session 自动过期，需用新密钥重新验证

---

## 4. 通用约定

### 4.1 基础地址

| 环境         | 后端 API 地址                                | 前端地址                                                |
| ------------ | -------------------------------------------- | ------------------------------------------------------- |
| **公网生产** | `https://cjdfnwwofgct.sealosgzg.site`        | `https://wmrazineousa.sealosgzg.site`                   |
| **内网调试** | `http://downloader-backend.ns-lnn76r5i:8080` | `http://ptedownload.ns-lnn76r5i.svc.cluster.local:3000` |
| **本地开发** | `http://localhost:8080`                      | `http://localhost:3000`                                 |

### 4.2 鉴权方式

| 角色     | 鉴权方式       | 有效期  | 传输方式                                          |
| -------- | -------------- | ------- | ------------------------------------------------- |
| 管理员   | JWT Token      | 24 小时 | HTTP Header: `Authorization: Bearer <token>`      |
| 普通用户 | Session Cookie | 30 分钟 | Cookie: `session_token=<token>`（浏览器自动携带） |

### 4.3 CORS 与跨域配置

后端 CORS 白名单（已在 [index.js](src/index.js) 中配置 `credentials: true`）：

| 来源                                                    | 用途             |
| ------------------------------------------------------- | ---------------- |
| `http://localhost:3000`                                 | 本地前端开发     |
| `https://wmrazineousa.sealosgzg.site`                   | 生产前端（公网） |
| `http://ptedownload.ns-lnn76r5i.svc.cluster.local:3000` | 生产前端（内网） |

> **前端注意**：所有需要携带 Cookie 的请求（`/api/auth/*`、`/api/files/*`）必须设置 `credentials: 'include'`，否则浏览器不会发送 `session_token` Cookie。管理员接口使用 JWT Header 鉴权，无需 credentials。

### 4.4 请求格式

- **JSON 请求**：`Content-Type: application/json`
- **文件上传**：`Content-Type: multipart/form-data`
- **参数位置**：GET 用路径参数，POST/PUT 用 JSON Body

### 4.5 响应格式

**成功响应**：

```json
{
  "id": 1,
  "title": "xxx"
}
// 或
{
  "success": true,
  "message": "操作成功"
}
```

**错误响应**：

```json
{
  "error": "错误描述信息"
}
```

---

## 5. 管理员接口

### 5.1 管理员登录

> 验证管理员密码，获取 JWT Token

| 属性             | 值                      |
| ---------------- | ----------------------- |
| **URL**          | `POST /api/admin/login` |
| **鉴权**         | 无                      |
| **Content-Type** | `application/json`      |

**请求体**：

```json
{
  "password": "admin123"
}
```

| 字段     | 类型   | 必填 | 说明                                             |
| -------- | ------ | ---- | ------------------------------------------------ |
| password | string | 是   | 管理员明文密码，与环境变量 `ADMIN_PASSWORD` 比对 |

**成功响应** (200)：

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

| 字段  | 类型   | 说明                                                     |
| ----- | ------ | -------------------------------------------------------- |
| token | string | JWT Token，有效期 24 小时，后续请求放入 Authorization 头 |

**错误响应**：

| 状态码 | 响应体                      | 触发条件             |
| ------ | --------------------------- | -------------------- |
| 400    | `{ "error": "请输入密码" }` | 未提供 password 字段 |
| 401    | `{ "error": "密码错误" }`   | 密码与环境变量不匹配 |

**前端代码示例**：

```javascript
async function adminLogin(password) {
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (res.ok) {
    localStorage.setItem("admin_token", data.token);
  }
  return data;
}
```

---

### 5.2 上传 PDF 文件

> 管理员上传 PDF 到服务器私有目录

| 属性             | 值                                            |
| ---------------- | --------------------------------------------- |
| **URL**          | `POST /api/admin/files/upload`                |
| **鉴权**         | 管理员 JWT（`Authorization: Bearer <token>`） |
| **Content-Type** | `multipart/form-data`                         |

**表单字段**：

| 字段        | 类型       | 必填 | 说明                                               |
| ----------- | ---------- | ---- | -------------------------------------------------- |
| file        | File (PDF) | 是   | PDF 文件本体，限制 `application/pdf`，最大 100MB   |
| title       | string     | 否   | 文件标题，不传则自动使用原始文件名（去 .pdf 后缀） |
| description | string     | 否   | 文件描述/备注                                      |

**成功响应** (201)：

```json
{
  "id": 1,
  "title": "产品手册 v2.0",
  "original_name": "产品手册.pdf",
  "size": 2048576
}
```

| 字段          | 类型   | 说明                 |
| ------------- | ------ | -------------------- |
| id            | number | 新建文件的数据库 ID  |
| title         | string | 最终存储的标题       |
| original_name | string | 用户上传的原始文件名 |
| size          | number | 文件大小（字节）     |

**错误响应**：

| 状态码 | 响应体                                          | 触发条件              |
| ------ | ----------------------------------------------- | --------------------- |
| 400    | `{ "error": "仅允许上传 PDF 文件" }`            | 上传了非 PDF 文件     |
| 400    | `{ "error": "请选择要上传的 PDF 文件" }`        | 未选择文件            |
| 401    | `{ "error": "未提供认证令牌" }`                 | 缺少 Authorization 头 |
| 401    | `{ "error": "认证令牌无效或已过期" }`           | JWT 过期或无效        |
| 413    | `{ "error": "文件大小超出限制（最大 100MB）" }` | PDF 超过 100MB        |
| 500    | `{ "error": "文件上传失败" }`                   | 服务器存储异常        |

**安全说明**：后端使用 `multer` 自动将文件重命名为 `UUID.pdf` 格式保存，避免中文路径、特殊字符注入和文件名冲突。

**前端代码示例**：

```javascript
async function uploadPDF(file, title, description) {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);
  if (description) formData.append("description", description);

  const res = await fetch("/api/admin/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
    },
    body: formData, // 不要手动设置 Content-Type，浏览器会自动带 boundary
  });
  return res.json();
}
```

---

### 5.3 获取文件列表（管理员）

> 返回全部文件的完整信息（含敏感路径字段）

| 属性     | 值                     |
| -------- | ---------------------- |
| **URL**  | `GET /api/admin/files` |
| **鉴权** | 管理员 JWT             |

**成功响应** (200)：

```json
[
  {
    "id": 1,
    "title": "产品手册 v2.0",
    "description": "2024年最新版",
    "original_name": "产品手册.pdf",
    "stored_name": "a1b2c3d4-e5f6-7890-abcd-ef1234567890.pdf",
    "stored_path": "/home/devbox/project/storage/pdfs/a1b2c3d4...pdf",
    "size": 2048576,
    "mime_type": "application/pdf",
    "status": "active",
    "download_count": 42,
    "created_at": "2025-06-05T08:30:00.000Z",
    "updated_at": "2025-06-05T12:00:00.000Z"
  }
]
```

| 字段           | 类型              | 说明                     |
| -------------- | ----------------- | ------------------------ |
| id             | number            | 文件 ID                  |
| title          | string            | 展示标题                 |
| description    | string\|null      | 文件描述                 |
| original_name  | string            | 原始上传文件名           |
| stored_name    | string            | 服务器安全文件名（UUID） |
| stored_path    | string            | 物理存储绝对路径         |
| size           | number            | 文件大小（字节）         |
| mime_type      | string            | MIME 类型                |
| status         | string            | `active` / `inactive`    |
| download_count | number            | 累计被下载次数           |
| created_at     | string (ISO 8601) | 上传时间                 |
| updated_at     | string (ISO 8601) | 最后更新时间             |

> **注意**：此接口仅管理员可调用，返回 `stored_name`/`stored_path` 便于后台管理。用户端接口**不会**暴露这些字段。

**错误响应**：

| 状态码 | 响应体                    | 触发条件          |
| ------ | ------------------------- | ----------------- |
| 401    | `{ "error": "..." }`      | 未认证或 JWT 过期 |
| 500    | `{ "error": "查询失败" }` | 数据库异常        |

---

### 5.4 删除文件

> 删除物理文件 + 数据库记录（事务性操作）

| 属性     | 值                            |
| -------- | ----------------------------- |
| **URL**  | `DELETE /api/admin/files/:id` |
| **鉴权** | 管理员 JWT                    |

**路径参数**：

| 参数 | 类型   | 说明            |
| ---- | ------ | --------------- |
| id   | number | 要删除的文件 ID |

**成功响应** (200)：

```json
{
  "success": true,
  "message": "文件已删除"
}
```

**错误响应**：

| 状态码 | 响应体                      | 触发条件                     |
| ------ | --------------------------- | ---------------------------- |
| 401    | `{ "error": "..." }`        | 未认证                       |
| 404    | `{ "error": "文件不存在" }` | ID 对应的文件不存在          |
| 500    | `{ "error": "删除失败" }`   | 物理文件删除或数据库操作异常 |

**前端代码示例**：

```javascript
async function deleteFile(id) {
  const res = await fetch(`/api/admin/files/${id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${localStorage.getItem("admin_token")}`,
    },
  });
  return res.json();
}
```

---

## 6. 用户鉴权接口

### 6.1 一次性密钥验证

> 用户输入访问密钥，验证通过后获得 30 分钟 Session Cookie

| 属性             | 值                          |
| ---------------- | --------------------------- |
| **URL**          | `POST /api/auth/verify-key` |
| **鉴权**         | 无                          |
| **Content-Type** | `application/json`          |

**请求体**：

```json
{
  "key": "ABCD-1234-EFGH-5678"
}
```

| 字段 | 类型   | 必填 | 说明                             |
| ---- | ------ | ---- | -------------------------------- |
| key  | string | 是   | 用户输入的一次性访问密钥（明文） |

**成功响应** (200)：

```json
{
  "success": true,
  "message": "验证成功，会话有效期为 30 分钟",
  "expires_at": "2025-06-05T09:30:00.000Z"
}
```

**响应头**：

```
Set-Cookie: session_token=<64位随机hex>; Max-Age=1800; Path=/; HttpOnly; SameSite=Strict; Secure
```

> **环境差异**：`Secure` 标志仅在 `NODE_ENV=production` 时启用（HTTPS）；本地 HTTP 开发时自动省略。

| 字段       | 说明                                             |
| ---------- | ------------------------------------------------ |
| success    | 固定 true                                        |
| message    | 提示信息                                         |
| expires_at | Session 过期时间（ISO 8601），当前时间 + 30 分钟 |

> **关键行为**：Cookie 设置 `httpOnly=true`，JavaScript **无法读取** `session_token`。浏览器会在后续所有同源请求中自动携带此 Cookie，无需前端手动处理。

**错误响应**：

| 状态码 | 响应体                                  | 触发条件                     |
| ------ | --------------------------------------- | ---------------------------- |
| 400    | `{ "error": "请提供访问密钥" }`         | 未提供 key 字段              |
| 401    | `{ "error": "访问密钥无效或已被使用" }` | 密钥不存在、已被使用或已过期 |

**前端代码示例**：

```javascript
async function verifyAccessKey(key) {
  const res = await fetch("/api/auth/verify-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
    credentials: "include", // 关键：允许接收和发送 Cookie
  });
  return res.json();
}
```

**密钥生命周期**：

```
access_keys 表状态转换:
  unused ──(用户验证成功)──> used (used_at = NOW)
                               │
                               └── 永久失效，不可复用
```

---

## 7. 用户文件接口

> 以下接口均需有效 Session Cookie（自动携带，无需手动设置）

### 7.1 获取文件列表（用户）

> 返回状态为 `active` 的文件列表，**不暴露物理路径**

| 属性     | 值                  |
| -------- | ------------------- |
| **URL**  | `GET /api/files`    |
| **鉴权** | 用户 Session Cookie |

**成功响应** (200)：

```json
[
  {
    "id": 1,
    "title": "产品手册 v2.0",
    "description": "2024年最新版",
    "size": 2048576,
    "created_at": "2025-06-05T08:30:00.000Z"
  },
  {
    "id": 2,
    "title": "技术白皮书",
    "description": null,
    "size": 5120000,
    "created_at": "2025-06-04T15:20:00.000Z"
  }
]
```

| 字段        | 类型              | 说明                        |
| ----------- | ----------------- | --------------------------- |
| id          | number            | 文件 ID（用于构建下载链接） |
| title       | string            | 展示标题                    |
| description | string\|null      | 文件描述                    |
| size        | number            | 文件大小（字节）            |
| created_at  | string (ISO 8601) | 上传时间                    |

> **安全设计**：前端拿不到 `stored_name` / `stored_path`，无法通过猜测路径直接访问文件。所有下载必须经过 `/api/files/:id/download` 鉴权链。

**错误响应**：

| 状态码 | 响应体                                        | 触发条件     |
| ------ | --------------------------------------------- | ------------ |
| 401    | `{ "error": "未登录，请先使用访问密钥验证" }` | 无 Cookie    |
| 401    | `{ "error": "会话已过期或无效，请重新验证" }` | Session 过期 |
| 500    | `{ "error": "查询失败" }`                     | 数据库异常   |

**前端代码示例**：

```javascript
async function fetchFileList() {
  const res = await fetch("/api/files", {
    credentials: "include", // 自动携带 session_token Cookie
  });
  if (res.status === 401) {
    // Session 过期，引导用户重新输入密钥
    window.location.href = "/login";
    return [];
  }
  return res.json();
}
```

---

### 7.2 下载 PDF 文件（流式）

> 以流式方式下载指定 ID 的 PDF 文件。浏览器自动触发下载。

| 属性     | 值                            |
| -------- | ----------------------------- |
| **URL**  | `GET /api/files/:id/download` |
| **鉴权** | 用户 Session Cookie           |

**路径参数**：

| 参数 | 类型   | 说明                    |
| ---- | ------ | ----------------------- |
| id   | number | 文件 ID（来自列表接口） |

**成功响应** (200)：

```
Content-Type: application/pdf
Content-Disposition: attachment; filename*=UTF-8''%E4%BA%A7%E5%93%81%E6%89%8B%E5%86%8C.pdf

<PDF 二进制流>
```

| 响应头              | 说明                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| Content-Type        | `application/pdf`                                                           |
| Content-Disposition | `attachment` 触发浏览器下载；`filename*=UTF-8''...` 为 URL 编码的原始文件名 |

**后端异步行为**（不影响文件流输出）：

- 向 `download_logs` 插入审计记录（session_id, file_id, IP, User-Agent）
- `files.download_count += 1`
- `sessions.download_count += 1`

**错误响应**：

| 状态码 | 响应体                              | 触发条件                     |
| ------ | ----------------------------------- | ---------------------------- |
| 401    | `{ "error": "..." }`                | 未认证或 Session 过期        |
| 404    | `{ "error": "文件不存在" }`         | ID 无效或文件已下线          |
| 404    | `{ "error": "文件不存在于服务器" }` | 数据库记录存在但物理文件丢失 |
| 403    | `{ "error": "禁止访问" }`           | 检测到路径穿越攻击           |
| 500    | `{ "error": "下载失败" }`           | 流读取失败                   |

**前端代码示例（推荐方式）**：

```javascript
// 方案 1：直接通过链接下载（最简单）
// <a href="/api/files/1/download" download>下载</a>
// 浏览器自动携带 Cookie，触发下载

// 方案 2：fetch + Blob 下载（可显示加载状态）
async function downloadFile(fileId, filename) {
  const res = await fetch(`/api/files/${fileId}/download`, {
    credentials: "include",
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error);
  }

  // 以流式读取并触发浏览器下载
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename; // 使用列表接口返回的 title + '.pdf'
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

> **注意**：方案 1 最简单，但无法处理错误（401 时浏览器会下载错误 JSON 而非 PDF）。方案 2 更健壮，可先检查响应状态再决定是提示错误还是触发下载。

---

## 8. Session 机制详解

### 8.1 Token 生命周期

```
用户输入密钥
    │
    ▼
POST /api/auth/verify-key  { key: "ABCD-..." }
    │
    ├── bcrypt.compare 逐条比对 access_keys.key_hash
    ├── 匹配成功 → 开启事务
    │     ├── UPDATE access_keys SET status='used', used_at=NOW()
    │     ├── 生成 64 位随机 hex token (crypto.randomBytes 32)
    │     ├── SHA-256(token) → token_hash 存入 sessions 表
    │     └── expires_at = NOW() + 30min
    ├── 提交事务
    │
    ▼
Set-Cookie: session_token=<原始token>
    │
    │  浏览器自动保存（httpOnly, sameSite=strict, maxAge=1800）
    │
    ▼
后续请求自动携带 Cookie
    │
    ├── SHA-256(Cookie中的token) → 查询 sessions.token_hash
    ├── 检查 expires_at > NOW()
    ├── 有效 → 更新 last_seen_at，放行
    └── 无效/过期 → 401
```

### 8.2 安全设计要点

| 设计                      | 说明                                                                      |
| ------------------------- | ------------------------------------------------------------------------- |
| Cookie 存原始 Token       | 浏览器自动携带，前端 JS 无法读取（httpOnly）                              |
| 数据库存 SHA-256 哈希     | 即使数据库泄露，攻击者无法从哈希反推有效 Cookie 值                        |
| 每次请求更新 last_seen_at | 活跃会话持续延长实际可用时间（便于审计，不影响 expires_at 硬过期）        |
| bcrypt 存储密钥           | `access_keys.key_hash` 使用 bcrypt 加盐哈希，明文密钥仅创建时可见         |
| 密钥一次性消费            | 使用后 status 变为 `used`，不可复用；消费与会话创建在同一事务中保证原子性 |

### 8.3 生产环境 Cookie 差异

| 属性       | 本地开发 (HTTP) | 生产环境 (HTTPS)                                |
| ---------- | --------------- | ----------------------------------------------- |
| `HttpOnly` | ✅              | ✅                                              |
| `SameSite` | `Strict`        | `Strict`（前后端同为 `*.sealosgzg.site`，兼容） |
| `Secure`   | ❌ 省略         | ✅ 启用                                         |
| `Max-Age`  | 1800s           | 1800s                                           |

> **同站说明**：`cjdfnwwofgct.sealosgzg.site` 和 `wmrazineousa.sealosgzg.site` 的 eTLD+1 均为 `sealosgzg.site`，浏览器判定为同站（same-site），`SameSite=Strict` Cookie 在跨子域请求中正常发送。

### 8.4 过期处理

- **硬过期**：`sessions.expires_at` 到期后，即使最近活跃也会被拒绝
- **Cookie 过期**：浏览器侧 `maxAge=1800s`，30 分钟后浏览器自动清除 Cookie
- **双重保障**：服务器侧时间判断 + 浏览器侧 Cookie 过期，任一触发均需重新验证

---

## 9. 错误码参考

| 状态码 | 含义       | 常见场景                                             |
| ------ | ---------- | ---------------------------------------------------- |
| 200    | 成功       | GET/POST 正常响应                                    |
| 201    | 已创建     | 文件上传成功                                         |
| 400    | 请求错误   | 缺少必填参数、文件格式不对                           |
| 401    | 未认证     | JWT 过期/无效、Session 过期/无效、密码错误、密钥无效 |
| 403    | 禁止访问   | 路径穿越检测触发                                     |
| 404    | 未找到     | 文件 ID 不存在、物理文件丢失                         |
| 413    | 内容过大   | PDF 超过 100MB 限制                                  |
| 500    | 服务器错误 | 数据库连接异常、文件系统错误                         |

---

## 10. 前端对接 CheckList

### 管理员后台页

- [ ] **登录页** — 密码输入框 → `POST /api/admin/login` → 存 JWT 到 localStorage
- [ ] **JWT 过期处理** — 请求返回 401 时自动跳转登录页
- [ ] **文件列表页** — `GET /api/admin/files` → 表格展示（含下载次数、上传时间）
- [ ] **上传页** — 文件选择器（accept=".pdf"）+ 标题 + 描述 → `POST /api/admin/files/upload`
- [ ] **删除按钮** — 确认弹窗 → `DELETE /api/admin/files/:id` → 刷新列表
- [ ] **请求拦截器** — 统一在请求头注入 `Authorization: Bearer <token>`

### 用户访问页

- [ ] **密钥输入页** — 输入框 → `POST /api/auth/verify-key` → 成功后跳转文件列表
- [ ] **错误提示** — 密钥无效/已使用时显示友好提示
- [ ] **文件列表页** — `GET /api/files` → 卡片/列表展示（标题、描述、大小）
- [ ] **下载按钮** — 点击 → `GET /api/files/:id/download` → 浏览器触发下载
- [ ] **下载 Loading** — 大文件时显示进度提示（推荐 fetch+blob 方案）
- [ ] **Session 过期处理** — 请求返回 401 时自动跳回密钥输入页
- [ ] **fetch 配置** — 所有用户请求加 `credentials: 'include'`

### 通用

- [ ] **环境变量** — 区分开发/生产 API 地址（见 [4.1 基础地址](#41-基础地址)）
- [ ] **API 地址配置** — 生产环境 `https://cjdfnwwofgct.sealosgzg.site`，本地 `http://localhost:8080`
- [ ] **CORS 确认** — 确认前端域名在后端 CORS 白名单中（`credentials: true` 模式）
- [ ] **HTTPS 确认** — 生产环境确保前端也使用 HTTPS（Cookie 带 `Secure` 标志，HTTP 下浏览器会拒绝）
- [ ] **错误兜底** — 所有接口调用包裹 try/catch，网络异常时友好提示
- [ ] **文件大小显示** — 将字节转为可读格式（KB/MB）
- [ ] **日期格式化** — 将 ISO 8601 转为本地可读时间
- [ ] **前端端口** — 开发环境运行在 `3000` 端口，生产环境同理
