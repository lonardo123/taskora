import { Pool, neonConfig } from '@neondatabase/serverless';

// Cloudflare Workers WebSocket
neonConfig.webSocketConstructor = WebSocket;

let _env = null;

export function initDb(env) {
  _env = env;

  if (!_env) {
    throw new Error('Cloudflare env is missing');
  }

  const connectionString =
    _env?.HYPERDRIVE?.connectionString ||
    _env?.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'No database connection: HYPERDRIVE.connectionString and DATABASE_URL are both missing'
    );
  }

  return true;
}

function getConnectionString() {
  if (_env?.HYPERDRIVE?.connectionString) {
    return _env.HYPERDRIVE.connectionString;
  }

  if (_env?.DATABASE_URL) {
    return _env.DATABASE_URL;
  }

  throw new Error(
    'No database connection: HYPERDRIVE.connectionString and DATABASE_URL are both missing'
  );
}

function createPool() {
  return new Pool({
    connectionString: getConnectionString()
  });
}

export const pool = {
  query: async (...args) => {
    if (!_env) {
      throw new Error(
        'Database not initialized. Call initDb(env) before using pool.'
      );
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
      throw new Error(
        'Database not initialized. Call initDb(env) before using pool.'
      );
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
