import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { AppException } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: process is up. Used by the Docker healthcheck. */
  @Public()
  @SkipThrottle()
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: database reachable. Deliberately reveals nothing else. */
  @Public()
  @SkipThrottle()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      throw new AppException('internal_error', 503);
    }
  }
}
