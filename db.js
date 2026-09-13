import { Pool, neonConfig } from '@neondatabase/serverless';

neonConfig.webSocketConstructor = WebSocket;

let poolInstance = null;

export function initDb(env) {
  if (!env || !env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing');
  }
  
  if (!poolInstance) {
    poolInstance = new Pool({
      connectionString: env.DATABASE_URL,
    });
  }
  
  return poolInstance;
}

export const pool = {
  query: async (...args) => {
    if (!poolInstance) {
      throw new Error('Database not initialized');
    }
    return await poolInstance.query(...args);
  },

  connect: async () => {
    if (!poolInstance) {
      throw new Error('Database not initialized');
    }
    return await poolInstance.connect();
  },

  on: (event, callback) => {
    if (poolInstance) {
      poolInstance.on(event, callback);
    }
  }
};
