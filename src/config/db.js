const mysql = require('mysql2/promise');

// 兼容两种命名惯例：DB_PASS（项目使用）和 DB_PASSWORD（平台约定）
const dbPassword = process.env.DB_PASS || process.env.DB_PASSWORD || '';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: dbPassword,
  database: process.env.DB_NAME || 'downloader',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 5000, // TCP 连接超时 5 秒（避免 DB 不可达时长时间卡死）
  charset: 'utf8mb4',
});

// 启动时输出连接目标（隐藏密码）
console.log(`[数据库] 连接目标: mysql://${process.env.DB_USER || 'root'}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'downloader'}`);
if (!dbPassword) {
  console.error('[数据库] ⚠️  未设置 DB_PASS 或 DB_PASSWORD 环境变量！');
  console.error('[数据库] 请检查: 1) .env 文件是否存在  2) 容器环境变量是否注入');
}

// 监听连接池级别错误，防止未捕获异常导致进程崩溃
pool.on('error', (err) => {
  console.error('[数据库] 连接池异常:', err.message);
});

module.exports = pool;
