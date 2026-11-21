#!/usr/bin/env node
// Production entrypoint:  pnpm --filter @670send/web build && pnpm --filter @670send/web start
// `next start` cannot serve an `output: 'standalone'` build, so this copies the static assets next to the
// standalone server (the Docker image of Phase 8 does the same) and runs it.  PORT (default 3100), WEB_HOST (default 0.0.0.0).
import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// In a pnpm monorepo the standalone tree mirrors the repo layout: .next/standalone/apps/web/server.js
const dir = path.join(root, '.next', 'standalone', 'apps', 'web');
if (!existsSync(path.join(dir, 'server.js'))) {
  console.error('No standalone build found. Run `pnpm --filter @670send/web build` first.');
  process.exit(1);
}
cpSync(path.join(root, '.next', 'static'), path.join(dir, '.next', 'static'), { recursive: true });
if (existsSync(path.join(root, 'public'))) cpSync(path.join(root, 'public'), path.join(dir, 'public'), { recursive: true });

const child = spawn(process.execPath, ['server.js'], {
  cwd: dir,
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.PORT ?? '3100', HOSTNAME: process.env.WEB_HOST ?? '0.0.0.0', NODE_ENV: 'production' },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
