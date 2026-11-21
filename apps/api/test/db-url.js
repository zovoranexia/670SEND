/** Derive the isolated test-database URL from the dev DATABASE_URL (same server, db `<name>_test`). */
function testDatabaseUrl(base) {
  if (!base) throw new Error('DATABASE_URL is not set (copy .env.example to .env at the repo root)');
  const url = new URL(base);
  const db = url.pathname.replace(/^\//, '');
  if (!db) throw new Error('DATABASE_URL has no database name');
  url.pathname = `/${db.endsWith('_test') ? db : `${db}_test`}`;
  return url.toString();
}

module.exports = { testDatabaseUrl };
