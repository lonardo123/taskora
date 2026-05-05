require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log('✅ قاعدة البيانات متصلة بنجاح'))
  .catch(err => console.error('❌ فشل الاتصال بقاعدة البيانات:', err));

module.exports = { pool };
