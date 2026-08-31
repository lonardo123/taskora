import { Client } from 'pg';

let _env = null;

export function initDb(env) {
  _env = env;
  return createPool();
}

function getConnectionString() {
  if (_env?.HYPERDRIVE?.connectionString) {
    return _env.HYPERDRIVE.connectionString;
  }
  if (_env?.DATABASE_URL) {
    console.warn('⚠️ HYPERDRIVE binding not found — falling back to DATABASE_URL');
    return _env.DATABASE_URL;
  }
  throw new Error('No database connection: HYPERDRIVE binding and DATABASE_URL are both missing');
}

function createPool() {
  return {
    async query(text, params) {
      const client = new Client({ connectionString: getConnectionString() });
      await client.connect();
      try {
        return await client.query(text, params);
      } finally {
        await client.end();
      }
    },
    async connect() {
      const client = new Client({ connectionString: getConnectionString() });
      await client.connect();
      client.release = async () => { await client.end(); };
      return client;
    },
    on() {},
    async end() {},
  };
}

export const pool = {
  query: async (...args) => {
    if (!_env) throw new Error('Database not initialized. Ensure initDb(env) is called.');
    const p = createPool();
    return p.query(...args);
  },
  connect: async () => {
    if (!_env) throw new Error('Database not initialized. Ensure initDb(env) is called.');
    const p = createPool();
    return p.connect();
  },
  on: () => {},
};
