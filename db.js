import { Pool, neonConfig } from '@neondatabase/serverless';

// إجبار المكتبة على استخدام WebSocket المتوافق مع Cloudflare Workers
neonConfig.webSocketConstructor = WebSocket;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.connect()
  .then(() => console.log('✅ قاعدة البيانات متصلة بنجاح عبر Neon Serverless'))
  .catch(err => console.error('❌ فشل الاتصال بقاعدة البيانات:', err));
