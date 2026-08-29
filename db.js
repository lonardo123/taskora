import { Pool, neonConfig } from '@neondatabase/serverless';

// إجبار المكتبة على استخدام WebSocket المتوافق مع Cloudflare Workers
neonConfig.webSocketConstructor = WebSocket;

// دالة لتهيئة قاعدة البيانات (سيتم استدعاؤها من server.js عند أول طلب)
export function initDb(env) {
  if (!globalThis._dbPool) {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL is missing in Cloudflare Secrets');
    }
    globalThis._dbPool = new Pool({ connectionString: env.DATABASE_URL });
    console.log('✅ Database pool initialized successfully with Cloudflare Secrets');
  }
  return globalThis._dbPool;
}

// كائن "وهمي" يتصرف مثل pool الحقيقي، لكنه يهيئه بأمان عند أول استخدام
export const pool = {
  query: async (...args) => {
    if (!globalThis._dbPool) throw new Error('Database not initialized. Ensure initDb(env) is called.');
    return globalThis._dbPool.query(...args);
  },
  connect: async () => {
    if (!globalThis._dbPool) throw new Error('Database not initialized. Ensure initDb(env) is called.');
    return globalThis._dbPool.connect();
  },
  on: (event, callback) => {
    // هذا يمنع الخطأ عند استدعاء pool.on في أعلى الملف قبل التهيئة
    if (globalThis._dbPool) {
      globalThis._dbPool.on(event, callback);
    }
  }
};
