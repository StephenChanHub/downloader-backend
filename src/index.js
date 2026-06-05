require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initStorage } = require('./config/init');

const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const filesRoutes = require('./routes/files');

const app = express();

// ---------------------------------------------------------------------------
// 全局中间件
// ---------------------------------------------------------------------------

// 安全头（防止常见 Web 漏洞）
app.use(helmet());

// 跨域支持（前后端分离部署在不同子域，需开启 credentials 以支持 Cookie）
const ALLOWED_ORIGINS = [
  'http://localhost:3000',                                // 本地前端开发
  'https://wmrazineousa.sealosgzg.site',                  // 生产前端（公网）
  'http://ptedownload.ns-lnn76r5i.svc.cluster.local:3000', // 生产前端（内网）
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // 允许无 Origin 的请求（如 curl、服务器间调用、同源请求）
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] 拒绝未知来源: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true, // 允许携带 Cookie（session_token）
}));

// JSON 请求体解析
app.use(express.json());

// Cookie 解析
app.use(cookieParser());

// ---------------------------------------------------------------------------
// 路由挂载
// ---------------------------------------------------------------------------
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/files', filesRoutes);

// ---------------------------------------------------------------------------
// 全局错误处理
// ---------------------------------------------------------------------------

// Multer 文件类型/大小校验错误
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '文件大小超出限制（最大 100MB）' });
  }
  if (err.message === '仅允许上传 PDF 文件') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// 通用错误兜底
app.use((err, req, res, _next) => {
  console.error('[Server] 未捕获错误:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

// ---------------------------------------------------------------------------
// 启动服务
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 8080;

async function start() {
  // 初始化 PDF 存储目录
  await initStorage();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] PDF 分发系统已启动: http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[Server] 启动失败:', err);
  process.exit(1);
});
