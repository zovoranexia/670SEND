import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Inject, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppException } from './errors';
import { RequestContext } from './request-context';
import { ENV, type Env } from '../config/env';
import { LocalizationService } from '../i18n/i18n.module';

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

const STATUS_TO_CODE: Record<number, string> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'validation_failed',
  413: 'file_too_large',
  415: 'file_type_not_allowed',
  422: 'validation_failed',
  423: 'account_locked',
  429: 'too_many_requests',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');

  constructor(
    private readonly i18n: LocalizationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const locale = this.i18n.currentLocale(req.header('accept-language'));
    const requestId = RequestContext.current()?.requestId;

    let status = 500;
    let code = 'internal_error';
    let params: Record<string, string | number> | undefined;
    let details: unknown;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      params = exception.params;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_TO_CODE[status] ?? (status < 500 ? 'validation_failed' : 'internal_error');
      if (status === 413) params = { maxKb: Math.floor(this.env.UPLOAD_MAX_BYTES / 1024) };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = 409;
        code = 'validation_failed';
      } else if (exception.code === 'P2025') {
        status = 404;
        code = 'not_found';
      }
    }

    if (status >= 500) {
      this.log.error(
        `[${requestId}] ${req.method} ${req.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      code,
      message: this.i18n.error(code, locale, params),
      requestId,
    };
    if (Array.isArray(details)) {
      body.details = details.map((d: { path?: string; message?: string }) => ({
        path: d.path,
        message: d.message?.startsWith('errors.') ? this.i18n.translate(d.message, locale) : d.message,
      }));
    } else if (details !== undefined) {
      body.details = details;
    }

    if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    if (status === 429 || code === 'request_in_progress') res.setHeader('Retry-After', '5');
    res.status(status).json(body);
  }
}
