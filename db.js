const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
});

// Проверка подключения при старте
pool.query('SELECT NOW()')
  .then(() => console.log('✅ PostgreSQL подключён'))
  .catch(err => console.error('❌ Ошибка подключения к PostgreSQL:', err));

module.exports = { pool };