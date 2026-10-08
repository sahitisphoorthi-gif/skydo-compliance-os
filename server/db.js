require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
  user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'compliance_os',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true,
  charset: 'utf8mb4'
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function all(sql, params = []) {
  return query(sql, params);
}

async function run(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return {
    insertId: result.insertId,
    affectedRows: result.affectedRows,
    changes: result.affectedRows,
    warningStatus: result.warningStatus
  };
}

async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const tx = {
      query: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return rows;
      },
      get: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return rows[0] || null;
      },
      run: async (sql, params = []) => {
        const [result] = await connection.execute(sql, params);
        return { insertId: result.insertId, affectedRows: result.affectedRows, changes: result.affectedRows };
      }
    };
    const result = await work(tx);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function ping() {
  await pool.query('SELECT 1');
  return true;
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, get, all, run, transaction, ping, close };
