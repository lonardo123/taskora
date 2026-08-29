import { Pool, neonConfig } from '@neondatabase/serverless';

// إجبار المكتبة على استخدام WebSocket المتوافق مع Cloudflare
neonConfig.webSocketConstructor = WebSocket;

// خدعة ذكية: نصدر كائن pool يحتوي على دوال تبحث عن الاتصال الحقيقي في globalThis
// هذا يسمح للكود القديم (pool.query) بالعمل دون تعديله
export const pool = {
  query: async (...args) => {
    if (!globalThis.dbPool) throw new Error('Database not initialized');
    return globalThis.dbPool.query(...args);
  },
  connect: async () => {
    if (!globalThis.dbPool) throw new Error('Database not initialized');
    return globalThis.dbPool.connect();
  },
  on: (event, cb) => {
    if (globalThis.dbPool) globalThis.dbPool.on(event, cb);
  }
};

// دالة لتهيئة الاتصال الفعلي (سيتم استدعاؤها من server.js)
export function initPool(connectionString) {
  if (!globalThis.dbPool) {
    if (!connectionString) {
      throw new Error('DATABASE_URL is missing in Cloudflare Secrets');
    }
    globalThis.dbPool = new Pool({ connectionString });
    console.log('✅ Database pool initialized successfully');
  }
  return globalThis.dbPool;
}
