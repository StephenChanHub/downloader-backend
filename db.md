-- 设置默认字符集为 utf8mb4
SET NAMES utf8mb4;

-- ==========================================
-- 1. 文件信息表 (files)
-- ==========================================
CREATE TABLE IF NOT EXISTS `files` (
  `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '文件唯一标识',
  `title` VARCHAR(255) NOT NULL COMMENT '前端展示的文件标题',
  `description` TEXT NULL COMMENT '文件描述',
  `original_name` VARCHAR(255) NOT NULL COMMENT '上传时的原始文件名',
  `stored_name` VARCHAR(255) NOT NULL COMMENT '服务器端生成的安全文件名',
  `stored_path` VARCHAR(255) NOT NULL COMMENT '物理存储路径(PVC路径)',
  `size` BIGINT NOT NULL COMMENT '文件大小(字节)',
  `mime_type` VARCHAR(50) DEFAULT 'application/pdf' COMMENT '文件MIME类型',
  `status` VARCHAR(20) DEFAULT 'active' COMMENT '状态: active/inactive',
  `download_count` INT DEFAULT 0 COMMENT '该文件被下载的总次数',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文件元数据表';

-- ==========================================
-- 2. 一次性密钥表 (access_keys)
-- ==========================================
CREATE TABLE IF NOT EXISTS `access_keys` (
  `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '密钥唯一标识',
  `key_hash` VARCHAR(255) NOT NULL UNIQUE COMMENT '加盐哈希后的密钥值',
  `status` VARCHAR(20) DEFAULT 'unused' COMMENT '状态: unused/used/expired',
  `expires_at` DATETIME NULL COMMENT '密钥绝对过期时间',
  `used_at` DATETIME NULL COMMENT '首次被使用/激活的时间',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '密钥生成时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统访问门票表';

-- ==========================================
-- 3. 临时会话表 (sessions)
-- ==========================================
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '会话唯一标识',
  `token_hash` VARCHAR(255) NOT NULL UNIQUE COMMENT '会话Token哈希值',
  `type` VARCHAR(20) DEFAULT 'user' COMMENT '会话类型: user/admin',
  `related_key_id` INT NULL COMMENT '关联的access_keys表ID',
  `download_count` INT DEFAULT 0 COMMENT '当前会话周期内已下载的次数',
  `expires_at` DATETIME NOT NULL COMMENT '会话强制过期时间',
  `last_seen_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '最后活跃心跳时间',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '会话创建时间',
  INDEX `idx_token_hash` (`token_hash`),
  INDEX `idx_expires_at` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='短期授权会话表';

-- ==========================================
-- 4. 下载审计日志表 (download_logs)
-- ==========================================
CREATE TABLE IF NOT EXISTS `download_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '日志唯一标识',
  `session_id` INT NOT NULL COMMENT '关联的会话ID',
  `file_id` INT NOT NULL COMMENT '被下载的文件ID',
  `ip` VARCHAR(45) NULL COMMENT '访问者IP地址(兼容IPv6)',
  `user_agent` VARCHAR(512) NULL COMMENT '客户端UA信息',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '下载发生时间',
  INDEX `idx_session_id` (`session_id`),
  INDEX `idx_file_id` (`file_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='下载行为审计日志';