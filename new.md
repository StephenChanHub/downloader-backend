# V2.2 更新日志 — 文件元数据编辑接口

> **发布日期**: 2026-06-17

---

## 一、后端变更

### 新增接口：`PATCH /api/admin/files/:id`

**认证**：需要管理员 JWT（`Authorization: Bearer <token>`）

**请求体**（至少提供一个字段，全部可选）：

```json
{
  "title": "新标题",
  "description": "新描述（可选）",
  "folder_name": "math_course（可选）"
}
```

**成功响应 `200`** — 返回更新后的完整文件记录：

```json
{
  "id": 1,
  "title": "新标题",
  "description": "新描述",
  "original_name": "课件资料.zip",
  "stored_name": "a1b2c3d4.zip",
  "size": 52428800,
  "mime_type": "application/zip",
  "status": "active",
  "folder_name": "math_course",
  "download_count": 5,
  "created_at": "2026-06-10T12:00:00.000Z",
  "updated_at": "2026-06-17T10:00:00.000Z"
}
```

### 校验规则

| 字段 | 类型 | 限制 |
|---|---|---|
| `title` | string | 最长 200 字符 |
| `description` | string | 最长 2000 字符 |
| `folder_name` | string | 最长 50 字符 |

### 错误响应

| 状态码 | 场景 |
|---|---|
| 400 | 无有效字段 / 至少需要传一个字段 |
| 400 | 字段超长 |
| 401 | 未认证或 JWT 过期 |
| 404 | 文件不存在 |
| 500 | 数据库错误 |

### 涉及文件

| 文件 | 变更 |
|---|---|
| [src/controllers/adminController.js](src/controllers/adminController.js) | 新增 `updateFile` 函数（~65 行），动态字段更新 + 输入校验 + 返回完整记录 |
| [src/routes/admin.js](src/routes/admin.js) | 新增 `PATCH /api/admin/files/:id` 路由 |

### 设计要点

1. **动态 UPDATE** — 只更新传入的字段，未传入的字段保持原值不变
2. **返回完整记录** — 更新后立即查询并返回最新文件元数据，前端可直接替换列表中的旧数据
3. **folder_name 可修改** — 管理员可将文件移动到不同文件夹，实现分类管理
4. **不影响物理文件** — 仅修改数据库 `files` 表，不操作存储层

---

## 二、前端对接工作

### 2.1 API 封装

**文件**：`src/api/admin.js` — 新增函数：

```javascript
export async function adminUpdateFile(id, updates) {
  const token = localStorage.getItem('admin_token');
  const res = await fetch(`/api/admin/files/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '更新失败');
  }
  return res.json();
}
```

### 2.2 方案一：内联编辑（推荐）

在管理员文件列表表格中，点击"编辑"按钮切换为输入框模式：

```jsx
const [editingId, setEditingId] = useState(null);
const [editTitle, setEditTitle] = useState('');
const [editFolder, setEditFolder] = useState('');

function startEdit(file) {
  setEditingId(file.id);
  setEditTitle(file.title);
  setEditFolder(file.folder_name || 'public');
}

async function saveEdit(fileId) {
  try {
    const updated = await adminUpdateFile(fileId, {
      title: editTitle,
      folder_name: editFolder,
    });
    setFiles(prev => prev.map(f => f.id === fileId ? updated : f));
    setEditingId(null);
  } catch (err) {
    alert(err.message);
  }
}

// JSX 中条件渲染
{editingId === file.id ? (
  <>
    <input value={editTitle} onChange={e => setEditTitle(e.target.value)} maxLength={200} />
    <input value={editFolder} onChange={e => setEditFolder(e.target.value)} maxLength={50} />
    <button onClick={() => saveEdit(file.id)}>保存</button>
    <button onClick={() => setEditingId(null)}>取消</button>
  </>
) : (
  <>
    <span>{file.title}</span>
    <button onClick={() => startEdit(file)}>编辑</button>
  </>
)}
```

### 2.3 方案二：最小实现（prompt 弹窗）

如果只需要快速改标题，更轻量：

```jsx
async function handleRename(file) {
  const newTitle = prompt('请输入新标题', file.title);
  if (!newTitle || newTitle === file.title) return;
  if (newTitle.length > 200) { alert('标题不能超过 200 字符'); return; }
  try {
    const updated = await adminUpdateFile(file.id, { title: newTitle });
    setFiles(prev => prev.map(f => f.id === file.id ? updated : f));
  } catch (err) { alert(err.message); }
}
```

---

## 三、curl 测试命令

```bash
# 更新标题
curl -X PATCH http://localhost:8080/api/admin/files/1 \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title": "新标题"}'

# 同时更新标题和文件夹
curl -X PATCH http://localhost:8080/api/admin/files/1 \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title": "新标题", "folder_name": "math_course"}'
```

---

## 四、部署检查清单

- [ ] `npm install`（无新增依赖）
- [ ] 重启后端服务
- [ ] 用 curl 测试 `PATCH /api/admin/files/1` → `{"title":"测试"}`
- [ ] 测试空 body → 应返回 400
- [ ] 测试超长标题 → 应返回 400
- [ ] 测试不存在的文件 ID → 应返回 404
- [ ] 前端添加 API 函数 + 编辑按钮
