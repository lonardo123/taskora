import { Pool, neonConfig } from '@neondatabase/serverless';

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
  throw new Error('No database connection: HYPERDRIVE and DATABASE_URL are both missing');
}

function createPool() {
  return new Pool({ connectionString: getConnectionString() });
}

export const pool = {
  query: async (...args) => {
    if (!_env) throw new Error('Database not initialized. Ensure initDb(env) is called.');
    return createPool().query(...args);
  },
  connect: async () => {
    if (!_env) throw new Error('Database not initialized. Ensure initDb(env) is called.');
    return createPool().connect();
  },
  on: () => {},
};
