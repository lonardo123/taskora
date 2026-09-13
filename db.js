import { Pool, neonConfig } from '@neondatabase/serverless';

// إعداد WebSocket ليعمل داخل Cloudflare Workers
neonConfig.webSocketConstructor = WebSocket;

let poolInstance = null;

export function initDb(env) {
  if (!env || !env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing in environment variables');
  }
  
  // إنشاء الـ Pool مرة واحدة فقط طوال عمر الـ Worker
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: env.DATABASE_URL,
    });
  }
  
  return poolInstance;
}

// تصدير واجهة آمنة تتوافق مع طريقة استخدامك في server.js
export const pool = {
  query: async (...args) => {
    if (!poolInstance) {
      throw new Error('Database not initialized. Call initDb(env) first.');
    }
    return await poolInstance.query(...args);
  },

  connect: async () => {
    if (!poolInstance) {
      throw new Error('Database not initialized. Call initDb(env) first.');
    }
    return await poolInstance.connect();
  },

  on: (event, callback) => {
    if (poolInstance) {
      poolInstance.on(event, callback);
    }
  }
};
