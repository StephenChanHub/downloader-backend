# V2.1 更新日志 — 压缩包支持 + 大文件优化

> **发布日期**: 2026-06-11

---

## 一、后端变更

### 1. 上传能力升级

| 项目 | 旧值 | 新值 |
|---|---|---|
| 最大文件体积 | 100MB | **500MB** |
| 支持格式 | 仅 PDF | **PDF + zip / rar / 7z / gz / tar / bz2 / xz / tgz** |
| 文件类型校验 | 仅 MIME | **MIME + 扩展名 + 幻数（Magic Bytes）三重校验** |
| 标题自动生成 | 仅去 `.pdf` | **通用去扩展名（支持复合扩展名 `.tar.gz`）** |

**涉及文件**：

- [`src/middleware/upload.js`](src/middleware/upload.js) — Multer 配置：500MB 上限、14 种 MIME 类型白名单、扩展名二次校验
- [`src/controllers/adminController.js`](src/controllers/adminController.js) — 新增 `detectFileType()` 幻数检测函数，支持 PDF/ZIP/RAR/7z/GZ/BZ2/XZ 7 种格式的二进制头部校验；新增 `extractTitle()` 通用标题提取
- [`src/index.js`](src/index.js) — Multer 错误处理消息更新

### 2. 下载性能优化

| 优化项 | 旧值 | 新值 | 效果 |
|---|---|---|---|
| 流式读取缓冲区 | 64KB（Node 默认） | **1MB** | 大文件 I/O 操作减少 16 倍 |
| 连接断开清理 | 无 | `res.on('close')` 销毁流 | 防止用户取消下载后资源泄漏 |
| 用户文件列表 | 无 `mime_type` | 新增 `mime_type` 字段 | 前端可根据类型显示不同图标 |

**涉及文件**：

- [`src/controllers/filesController.js`](src/controllers/filesController.js) — `highWaterMark: 1024 * 1024`、`res.on('close')` 资源清理、`listFiles` 增加 `mime_type` 返回

### 3. 上传接口返回值新增字段

`POST /api/admin/files/upload` 成功响应新增：

```json
{
  "id": 1,
  "title": "课件资料",
  "original_name": "课件资料.zip",
  "size": 52428800,
  "mime_type": "application/zip",
  "detected_type": "ZIP",
  "folder_name": "public"
}
```

| 字段 | 说明 |
|---|---|
| `mime_type` | 浏览器上报的 MIME 类型 |
| `detected_type` | 服务端幻数检测的实际类型（`PDF`/`ZIP`/`RAR`/`7z`/`GZIP`/`BZ2`/`XZ`） |

---

## 二、前端对接工作

### 2.1 上传表单改造

**文件**：`AdminPage` 上传区域

需要修改的点：

1. **文件选择器** — `accept` 属性扩展：
   ```jsx
   <input
     type="file"
     accept=".pdf,.zip,.rar,.7z,.gz,.tar,.bz2,.xz,.tgz"
     onChange={handleFileChange}
   />
   ```

2. **上传大小限制提示** — 更新为 500MB：
   ```jsx
   <p className="form-hint">支持 PDF、ZIP、RAR、7z、GZ、TAR、BZ2、XZ，最大 500MB</p>
   ```

3. **上传进度优化**（大文件推荐）：
   ```jsx
   // 使用 XMLHttpRequest 或 axios onUploadProgress 显示进度条
   const formData = new FormData();
   formData.append('file', file);
   formData.append('title', title);
   formData.append('description', description);
   formData.append('folder_name', folderName);

   const response = await axios.post('/api/admin/files/upload', formData, {
     headers: { 'Content-Type': 'multipart/form-data' },
     onUploadProgress: (e) => {
       const pct = Math.round((e.loaded / e.total) * 100);
       setUploadProgress(pct);
     },
     timeout: 600000, // 10 分钟超时（500MB 在慢网络上需要较长时间）
   });
   ```

4. **上传响应处理** — 适配新增字段：
   ```jsx
   // 旧代码只需 res.data.title，新字段可选使用
   const { id, title, size, mime_type, detected_type, folder_name } = response.data;
   // detected_type 可用于显示文件类型标签
   // mime_type 可用于前端渲染对应的文件图标
   ```

### 2.2 文件列表展示改造

**文件**：`ResourcesPage` / `AdminPage` 文件列表

`GET /api/files` 和 `GET /api/admin/files` 现在返回 `mime_type` 字段，前端可据此渲染文件类型图标：

```jsx
function getFileIcon(mimeType) {
  if (!mimeType) return <FileIcon />;
  if (mimeType === 'application/pdf') return <PdfIcon />;
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z'))
    return <ArchiveIcon />;
  if (mimeType.includes('gzip') || mimeType.includes('tar') || mimeType.includes('bz2'))
    return <ArchiveIcon />;
  return <FileIcon />;
}

// 在列表渲染中使用
{files.map(f => (
  <div key={f.id} className="file-item">
    {getFileIcon(f.mime_type)}
    <span>{f.title}</span>
    <span>{formatFileSize(f.size)}</span>
  </div>
))}
```

### 2.3 下载体验优化

**文件**：`ResourceCard` 或下载按钮组件

大文件下载建议：

1. **下载状态提示**：
   ```jsx
   const [downloading, setDownloading] = useState(null); // file id

   async function handleDownload(file) {
     setDownloading(file.id);
     try {
       // 大于 100MB 的文件，提示用户耐心等待
       if (file.size > 100 * 1024 * 1024) {
         showToast(`正在准备下载 ${file.title}，文件较大请耐心等待...`);
       }
       await downloadFile(file.id);
     } finally {
       setDownloading(null);
     }
   }
   ```

2. **文件大小友好显示**（500MB 级别需要）：
   ```jsx
   function formatFileSize(bytes) {
     if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024*1024*1024)).toFixed(2) + ' GB';
     if (bytes >= 1024 * 1024) return (bytes / (1024*1024)).toFixed(1) + ' MB';
     if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
     return bytes + ' B';
   }
   ```

### 2.4 数据库（如前端直连）

无需变更。`files` 表新增字段已通过 ALTER TABLE 添加（`mime_type` 字段原本已存在）。

---

## 三、兼容性说明

| 项目 | 兼容情况 |
|---|---|
| 旧 PDF 文件 | ✅ 完全兼容，上传/下载/列表均正常 |
| 旧前端（未更新 accept） | ⚠️ 文件选择器不会显示压缩包，需手动选择"所有文件" |
| API 返回格式 | ✅ 向后兼容，新增字段为增量，旧字段不变 |
| Cookie Session 逻辑 | ✅ 无变更 |
| 文件夹隔离 | ✅ 无变更 |
| Range 断点续传 | ✅ 已支持，500MB 文件下载可暂停/恢复 |

---

## 四、部署检查清单

- [ ] `npm install` 确认依赖无缺失（本次无新增依赖）
- [ ] 重启后端服务
- [ ] 测试上传 < 5MB 的小 PDF（验证向后兼容）
- [ ] 测试上传 200MB zip 包（验证大文件 + 新格式）
- [ ] 测试下载 200MB 文件（验证吞吐量 + Range 支持）
- [ ] 测试上传不支持的文件格式（验证拒绝逻辑）
- [ ] 前端更新 `accept` 属性、上传提示文案、文件图标逻辑
