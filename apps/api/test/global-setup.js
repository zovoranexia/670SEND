// Jest globalSetup: create (if missing) and migrate + seed an ISOLATED test database
// (`<dev db>_test`) on the same Postgres server. The dev database is never touched.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = async () => {
  require('dotenv').config({ path: [path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../../.env')], quiet: true });
  const { PrismaClient } = require('@prisma/client');
  const { testDatabaseUrl } = require('./db-url');

  const adminUrl = process.env.DATABASE_URL;
  const testUrl = testDatabaseUrl(adminUrl);
  const testDb = new URL(testUrl).pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/i.test(testDb)) throw new Error(`Refusing to drop a database that is not named *_test: ${testDb}`);

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    // Always start from an EMPTY database: wallet balances, sequences and agents from a previous run
    // can never leak into this one (the dev database is a different database and is never touched).
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${testDb}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${testDb}"`);
  } finally {
    await admin.$disconnect();
  }

  const cwd = path.resolve(__dirname, '..');
  const env = {
    ...process.env,
    DATABASE_URL: testUrl,
    NODE_ENV: 'development', // seed in "dev" mode so demo users exist
    SEED_DEMO_DATA: 'true',
    ARGON2_MEMORY_KIB: '8192',
  };
  const run = (args) => execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['exec', ...args], { cwd, env, stdio: 'pipe', shell: process.platform === 'win32' });

  run(['prisma', 'migrate', 'deploy']);
  run(['tsx', 'prisma/seed.ts']);
};
