import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma does not auto-load .env when a config file exists — load the monorepo root .env explicitly.
loadEnv({ path: [path.resolve(__dirname, '.env'), path.resolve(__dirname, '../../.env')] });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
