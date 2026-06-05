const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'downloader',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 5000, // TCP 连接超时 5 秒（避免 DB 不可达时长时间卡死）
  charset: 'utf8mb4',
});

// 监听连接池级别错误，防止未捕获异常导致进程崩溃
pool.on('error', (err) => {
  console.error('[数据库] 连接池异常:', err.message);
});

module.exports = pool;
