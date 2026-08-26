import { Pool, neonConfig } from '@neondatabase/serverless';

// إجبار المكتبة على استخدام WebSocket المتوافق مع Cloudflare Workers
neonConfig.webSocketConstructor = WebSocket;

// تهيئة الـ Pool فقط (بدون استدعاء connect() في المستوى الأعلى)
// سيتم الاتصال فعلياً وآمناً عند تنفيذ أول استعلام (Query)
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ملاحظة: تم إزالة pool.connect() من هنا لمنع خطأ النشر في Wrangler
console.log('✅ تم تهيئة اتصال قاعدة البيانات بنجاح (سيتم الاتصال عند أول طلب)');
