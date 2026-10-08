require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const statements = [
`CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(320) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','analyst','viewer') NOT NULL DEFAULT 'analyst',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exporter_id VARCHAR(255) NULL,
  title VARCHAR(500) NOT NULL,
  description TEXT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  priority VARCHAR(50) NOT NULL DEFAULT 'medium',
  assigned_to BIGINT UNSIGNED NULL,
  external_system VARCHAR(100) NULL,
  external_id VARCHAR(255) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tickets_status (status),
  KEY idx_tickets_exporter (exporter_id),
  KEY idx_tickets_created (created_at),
  CONSTRAINT fk_tickets_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tickets_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS ubos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exporter_id VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  designation VARCHAR(255) NULL,
  pan VARCHAR(50) NULL,
  ownership_percentage DECIMAL(8,3) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ubos_exporter (exporter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  exporter_id VARCHAR(255) NULL,
  ticket_id BIGINT UNSIGNED NULL,
  document_type VARCHAR(100) NOT NULL,
  original_name VARCHAR(500) NOT NULL,
  stored_name VARCHAR(500) NOT NULL,
  path VARCHAR(1000) NOT NULL,
  mime_type VARCHAR(255) NULL,
  size BIGINT UNSIGNED NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_documents_exporter (exporter_id),
  KEY idx_documents_ticket (ticket_id),
  CONSTRAINT fk_documents_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL,
  CONSTRAINT fk_documents_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS saved_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(500) NOT NULL,
  content LONGTEXT NOT NULL,
  source VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_saved_user_title (user_id, title),
  CONSTRAINT fk_saved_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS quiz_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  participant_name VARCHAR(255) NOT NULL,
  week_key VARCHAR(100) NOT NULL,
  score INT NOT NULL,
  max_score INT NOT NULL,
  percentage DECIMAL(6,2) NOT NULL,
  answers_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_quiz_participant_week (participant_name, week_key),
  CONSTRAINT fk_quiz_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(255) NOT NULL,
  entity_type VARCHAR(100) NULL,
  entity_id VARCHAR(255) NULL,
  metadata_json JSON NULL,
  ip VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_user (user_id),
  CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

`CREATE TABLE IF NOT EXISTS kb_files (
  id VARCHAR(191) NOT NULL,
  kind VARCHAR(20) NULL,
  asset_id VARCHAR(191) NULL,
  sheets_json JSON NULL,
  size BIGINT UNSIGNED NULL,
  name VARCHAR(500) NULL,
  title VARCHAR(500) NOT NULL,
  cat VARCHAR(100) NULL,
  mod VARCHAR(100) NULL,
  description TEXT NULL,
  by_user BIGINT UNSIGNED NULL,
  ts BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_kb_files_ts (ts),
  CONSTRAINT fk_kb_files_user FOREIGN KEY (by_user) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS kb_overrides (
  id VARCHAR(191) NOT NULL,
  asset_id VARCHAR(191) NULL,
  by_user BIGINT UNSIGNED NULL,
  ts BIGINT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_kb_overrides_user FOREIGN KEY (by_user) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS kb_queries (
  id VARCHAR(191) NOT NULL,
  title VARCHAR(500) NOT NULL,
  body TEXT NOT NULL,
  cat VARCHAR(255) NULL,
  by_name VARCHAR(255) NULL,
  uid BIGINT UNSIGNED NULL,
  ts BIGINT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  sol_text TEXT NULL,
  sol_by VARCHAR(255) NULL,
  sol_id VARCHAR(191) NULL,
  sol_ts BIGINT NULL,
  PRIMARY KEY (id),
  KEY idx_kb_queries_ts (ts),
  CONSTRAINT fk_kb_queries_user FOREIGN KEY (uid) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS kb_query_answers (
  id VARCHAR(191) NOT NULL,
  query_id VARCHAR(191) NOT NULL,
  by_name VARCHAR(255) NULL,
  uid BIGINT UNSIGNED NULL,
  text TEXT NOT NULL,
  ts BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_kb_answers_query (query_id),
  CONSTRAINT fk_kb_answers_query FOREIGN KEY (query_id) REFERENCES kb_queries(id) ON DELETE CASCADE,
  CONSTRAINT fk_kb_answers_user FOREIGN KEY (uid) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
`CREATE TABLE IF NOT EXISTS assets (
  id VARCHAR(191) NOT NULL,
  original_name VARCHAR(500) NOT NULL,
  path VARCHAR(1000) NOT NULL,
  mime_type VARCHAR(255) NULL,
  size BIGINT UNSIGNED NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_assets_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

(async () => {
  try {
    for (const sql of statements) await db.query(sql);
    const email = 'admin@skydo.local';
    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (!existing) {
      const hash = await bcrypt.hash('ChangeMe123!', 12);
      await db.run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)', ['Compliance Admin', email, hash, 'admin']);
      console.log('Created default admin: admin@skydo.local / ChangeMe123!');
    }
    await db.ping();
    console.log('MySQL database initialized successfully.');
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
