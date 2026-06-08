const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

// 日志目录（相对于项目根目录）
const LOG_DIR = path.resolve(__dirname, '..', '..', 'logs');

// 控制台输出格式：带颜色、精简
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

// 文件输出格式：完整 JSON（便于后续日志分析）
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
);

// 错误日志：按天轮转，保留 14 天
const errorTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
  level: 'error',
  format: fileFormat,
});

// 综合日志：按天轮转，保留 14 天
const combinedTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'combined-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxFiles: '14d',
  level: 'info',
  format: fileFormat,
});

// 控制台输出（开发环境：debug 级别；生产环境：info 级别）
const consoleTransport = new winston.transports.Console({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: consoleFormat,
});

const logger = winston.createLogger({
  level: 'info',
  transports: [errorTransport, combinedTransport, consoleTransport],
});

// 覆盖 console.log / console.error，确保所有日志统一流入 winston
// （保留原始引用用于启动早期阶段）
const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);

console.log = (...args) => {
  logger.info(args.map(String).join(' '));
};

console.error = (...args) => {
  logger.error(args.map(String).join(' '));
};

console.warn = (...args) => {
  logger.warn(args.map(String).join(' '));
};

module.exports = { logger, originalConsoleLog, originalConsoleError };
