import { Pool, neonConfig } from '@neondatabase/serverless';

// إعداد WebSocket ليعمل داخل Cloudflare Workers
neonConfig.webSocketConstructor = WebSocket;

let _env = null;

export function initDb(env) {
  _env = env;

  if (!_env) {
    throw new Error('Cloudflare env is missing');
  }

  // الاعتماد فقط على DATABASE_URL المباشر
  const connectionString = _env?.DATABASE_URL;

  if (!connectionString) {
    throw new Error('No database connection: DATABASE_URL is missing in environment variables');
  }

  return true;
}

function getConnectionString() {
  if (_env?.DATABASE_URL) {
    return _env.DATABASE_URL;
  }
  throw new Error('No database connection: DATABASE_URL is missing in environment variables');
}

function createPool() {
  return new Pool({
    connectionString: getConnectionString()
  });
}

export const pool = {
  query: async (...args) => {
    if (!_env) {
      throw new Error('Database not initialized. Call initDb(env) before using pool.');
    }
    const db = createPool();
    try {
      return await db.query(...args);
    } finally {
      try {
        await db.end();
      } catch {}
    }
  },

  connect: async () => {
    if (!_env) {
      throw new Error('Database not initialized. Call initDb(env) before using pool.');
    }
    const db = createPool();
    const client = await db.connect();
    const originalRelease = client.release.bind(client);

    client.release = async () => {
      try {
        originalRelease();
      } finally {
        try {
          await db.end();
        } catch {}
      }
    };
    return client;
  },

  on: (event, callback) => {
    if (!_env) return;
    try {
      const db = createPool();
      db.on(event, callback);
    } catch (err) {
      console.error('❌ PG pool event error:', err.message);
    }
  }
};
