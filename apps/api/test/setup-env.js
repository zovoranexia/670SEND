// Runs inside every Jest worker BEFORE test files: point the app at the isolated TEST database.
const path = require('node:path');
require('dotenv').config({ path: [path.resolve(__dirname, '../.env'), path.resolve(__dirname, '../../../.env')], quiet: true });

const { testDatabaseUrl } = require('./db-url');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL);
// Never throttle the test-suite itself (the throttling test builds its own limits).
process.env.RATE_LIMIT_PUBLIC_PER_MIN = '100000';
process.env.RATE_LIMIT_AUTH_PER_MIN = '100000';
process.env.S3_AUTO_CREATE_BUCKET = 'false';
process.env.LOG_LEVEL = 'error';
// Jobs run inline (no Redis needed); the Redis integration test turns this on for itself.
process.env.QUEUES_ENABLED = process.env.TEST_QUEUES_ENABLED ?? 'false';
process.env.WHATSAPP_PROVIDER = 'console';
// Faster hashing in tests only (production uses the .env values).
process.env.ARGON2_MEMORY_KIB = '8192';
process.env.ARGON2_TIME_COST = '2';
