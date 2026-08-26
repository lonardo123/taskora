import { Pool, neonConfig } from '@neondatabase/serverless';

// إجبار المكتبة على استخدام WebSocket المدمج والآمن في Cloudflare Workers
neonConfig.webSocketConstructor = WebSocket;

// تهيئة الـ Pool فقط (سيتم الاتصال فعلياً عند تنفيذ أول استعلام query)
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

console.log('✅ تم تهيئة اتصال قاعدة البيانات بنجاح (سيتم الاتصال عند أول طلب)');
