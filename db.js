import { Pool, neonConfig } from '@neondatabase/serverless';

// إجبار المكتبة على استخدام WebSocket المدمج في Cloudflare Workers
neonConfig.webSocketConstructor = WebSocket;

// إنشاء Pool متوافق تماماً مع بيئة Workers (يعمل عبر HTTP/WebSocket)
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// اختبار الاتصال عند بدء التشغيل
pool.connect()
  .then(() => console.log('✅ قاعدة البيانات متصلة بنجاح عبر Neon Serverless'))
  .catch(err => console.error('❌ فشل الاتصال بقاعدة البيانات:', err));
