require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

// 日志系统 — 必须在最前面加载，以覆盖全局 console
require('./utils/logger');

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { initStorage } = require('./config/init');

const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const filesRoutes = require('./routes/files');
const pool = require('./config/db');

const app = express();

// ---------------------------------------------------------------------------
// 启动诊断：检查关键环境变量
// ---------------------------------------------------------------------------
{
  const critical = ['ADMIN_PASSWORD', 'JWT_SECRET'];
  const missing = critical.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('⚠️  缺少关键环境变量:', missing.join(', '));
    console.error('');
    console.error('   可能原因:');
    console.error('   1. .env 文件被 .gitignore 排除，容器中不存在');
    console.error('   2. Sealos/Devbox 平台未注入环境变量');
    console.error('');
    console.error('   解决方法:');
    console.error('   - 在 Sealos 平台 → 应用 → 环境变量 中设置:');
    missing.forEach((k) => console.error(`     ${k}=<你的值>`));
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  } else {
    console.log('[环境] ADMIN_PASSWORD 已设置, 长度:', process.env.ADMIN_PASSWORD.length);
  }
}

// 信任 Sealos 网关代理（HTTPS 终止在网关，SameSite=None Cookie 需要）
app.set("trust proxy", 1);

// ---------------------------------------------------------------------------
// 全局中间件
// ---------------------------------------------------------------------------

// 安全头（防止常见 Web 漏洞）
app.use(helmet());

// HTTP 请求日志（通过 morgan 写入 winston 综合日志）
app.use(morgan('combined', {
  stream: { write: (msg) => console.log(msg.trim()) },
}));

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

// JSON 请求体解析（限制 1MB，防止大 payload 攻击）
app.use(express.json({ limit: '1mb' }));

// Cookie 解析
app.use(cookieParser());

// 用户端 API 限流：每个 IP 15 分钟内最多 1000 次请求
// 管理员路由（/api/admin）已有 JWT 认证 + 专属限流，不在此列
const { globalLimiter } = require('./middleware/rateLimiter');

// ---------------------------------------------------------------------------
// 路由挂载
// ---------------------------------------------------------------------------

// 健康检查端点（供网关 / istio-envoy 探活使用）
// 3 秒超时保护：DB 不可达时不会卡死
app.get('/api/health', async (_req, res) => {
  const dbPromise = (async () => {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    return true;
  })();

  const dbOk = await Promise.race([
    dbPromise,
    new Promise((r) => setTimeout(() => r(false), 3000)),
  ]).catch(() => false);

  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk,
    uptime: process.uptime(),
  });
});

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
  console.error('[Server] 未捕获错误 — 完整信息:');
  console.error('  message:', err.message);
  console.error('  code:', err.code);
  console.error('  stack:', err.stack);
  // 开发环境返回详细错误信息，方便调试
  const detail = process.env.NODE_ENV === 'development' ? err.message : undefined;
  res.status(500).json({ error: '服务器内部错误', detail });
});

// ---------------------------------------------------------------------------
// 启动服务
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 8080;

async function start() {
  // 初始化 PDF 存储目录（失败不阻止启动，上传功能会降级）
  await initStorage();

  // 验证数据库连接（3 秒超时，失败不阻止启动）
  try {
    const dbPromise = (async () => {
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
    })();
    await Promise.race([
      dbPromise,
      new Promise((_, r) => setTimeout(() => r(new Error('连接超时')), 3000)),
    ]);
    console.log('[数据库] MySQL 连接验证成功');
  } catch (err) {
    console.error(`[数据库] ⚠️  MySQL 连接失败: ${err.message}`);
    console.error('[数据库] 服务将继续运行，但 API 调用将返回 500');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] PDF 分发系统已启动: http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('[Server] 启动失败:', err);
  process.exit(1);
});
