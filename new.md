> **【V2.0 升级目标】**
> 当前基础功能已通过 30 人并发测试，非常稳定。现在我需要你配合我进行 **V2.0 版本的进阶升级**。升级分为三个维度，请你仔细阅读以下工作流，**但我要求你先不要一次性把所有代码全写出来，而是等我下达“开始 Phase X”的指令后，再逐一输出。**
>
> ---
>
> ### 🚀 工作流与任务拆解 (V2.0)
>
> #### Phase 1: 用户体验升级 (UX Enhancement)
>
> **任务 1.1：文件列表的分页与搜索**
>
> - **后端侧 (`filesController.js`)**：改造 `GET /api/files` 接口，支持接收 `?page=1&limit=20&search=xxx` 参数。使用 SQL 的 `LIMIT` 和 `OFFSET` 实现分页，使用 `LIKE '%xxx%'` 对 `title` 进行模糊搜索。返回格式需包含 `total`（总条数）和 `files`（当前页数据）。
> - **前端侧**：在列表页顶部增加搜索框；底部增加分页器组件 (Pagination)。
>
> **任务 1.2：PDF 在线预览功能**
>
> - **前端侧**：在文件列表中增加一个“预览”按钮。点击后，弹出一个 Modal（模态框）或打开新路由，使用 `<iframe src="/api/files/:id/download">` 配合浏览器原生 PDF 解析器，或者集成轻量级的 `pdfjs-dist` / `react-pdf` 实现网页端直接阅读。
>
> #### Phase 2: 安全与防御强化 (Stability & Security)
>
> **任务 2.1：高频防爆破限流 (Rate Limiting)**
>
> - **后端侧 (`index.js` & `auth.js`)**：引入 `express-rate-limit`。
> - 针对全局 API：限制每个 IP 15 分钟内最多 500 次请求。
> - 针对 `/api/auth/verify-key`（门票验证接口）：严格限制每个 IP 1 分钟内最多试错 5 次，超出则封禁 15 分钟。提示信息：“请求过于频繁，请稍后再试”。
>
> **任务 2.2：断点续传与大文件并发支持**
>
> - **后端侧 (`filesController.js`)**：优化 `downloadFile` 控制器。解析客户端发来的 `Range` 请求头。如果包含 `Range`，则使用 `fs.createReadStream(path, { start, end })` 返回 `206 Partial Content`。这能极大降低服务器瞬时内存压力，支持下载工具多线程下载和暂停/恢复。
>
> #### Phase 3: 监控与可视化看板 (Observability & Admin)
>
> **任务 3.1：专业化日志系统**
>
> - **后端侧**：移除控制台杂乱的 `console.log`。引入 `winston` 和 `winston-daily-rotate-file`。
> - 配置策略：控制台输出带颜色的精简日志；将详细报错日志写入 `logs/error-%DATE%.log`，日常访问/审计日志写入 `logs/combined-%DATE%.log`（最多保留 14 天）。结合 `morgan` 记录所有 HTTP 请求。
>
> **任务 3.2：管理员统计仪表盘 (Dashboard)**
>
> - **后端侧 (`adminController.js`)**：新增 `GET /api/admin/stats` 接口。
> - 统计指标 1：总存储空间占用（利用 Node.js `fs.stat` 遍历或直接 `SUM(size)` 数据库聚合）。
> - 统计指标 2：今日活跃访客数（统计 `download_logs` 或 `sessions` 表今日的 unique IP/Session）。
> - 统计指标 3：历史下载量 Top 10 的文件。
> - **前端侧**：在管理员后台首页绘制 Dashboard 面板，以卡片形式展示数据（如有需要可引入 `recharts` 等轻量图表库）。
>
> ---
>
> **【代码生成规则】**
>
> 1. **增量修改**：在输出代码时，请明确指出“在哪个文件的哪一行”进行添加或替换，不要每次都输出整个几百行的文件。
> 2. **保持原逻辑不变**：绝对不能破坏现有的 `category` 分类逻辑、Cookie Session 逻辑和 CORS 配置。
> 3. **环境兼容**：所有新功能必须兼容现有的 Sealos Kubernetes 部署环境及代理模式。
>
> **如果你已经理解了当前架构、升级目标和规则，请回复：“我已完全理解 V2.0 升级计划，架构上下文已加载。请下达指令开始执行某个具体的 Phase 或任务。”**

---
