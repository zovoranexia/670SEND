import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnvFile } from 'dotenv';

// Load the monorepo .env for local development. In production variables are injected by Docker.
loadEnvFile({ path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')], quiet: true });

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { ENV, loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // fail fast with a readable list of every bad variable
  const levels = ['error', 'warn', 'log', 'debug', 'verbose'] as const;
  const app = await NestFactory.create(AppModule, {
    logger: levels.slice(0, levels.indexOf(env.LOG_LEVEL) + 1) as unknown as ('error' | 'warn' | 'log' | 'debug' | 'verbose')[],
  });
  configureApp(app);
  const port = app.get<{ API_PORT: number }>(ENV).API_PORT;
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`670Send API listening on :${port} (${env.NODE_ENV}) — prefix /v1`);
}

void bootstrap();
