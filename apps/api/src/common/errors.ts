import { HttpException } from '@nestjs/common';

export type ErrorParams = Record<string, string | number>;

/**
 * Business error with a stable machine `code`. The human message is NEVER hard-coded:
 * the exception filter resolves `errors.<code>` in the caller's language
 * (authenticated user's preferred_lang → Accept-Language → Tetun).
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    status: number,
    public readonly params?: ErrorParams,
    public readonly details?: unknown,
  ) {
    super({ code }, status);
  }
}

export const Err = {
  validation: (details?: unknown) => new AppException('validation_failed', 422, undefined, details),
  unauthorized: () => new AppException('unauthorized', 401),
  invalidCredentials: () => new AppException('invalid_credentials', 401),
  refreshInvalid: () => new AppException('refresh_invalid', 401),
  forbidden: () => new AppException('forbidden', 403),
  accountInactive: () => new AppException('account_inactive', 403),
  accountLocked: () => new AppException('account_locked', 423),
  notFound: () => new AppException('not_found', 404),
  idempotencyConflict: () => new AppException('idempotency_conflict', 422),
  idempotencyKeyRequired: () => new AppException('idempotency_key_required', 400),
  requestInProgress: () => new AppException('request_in_progress', 409),
  auditReasonRequired: () => new AppException('audit_reason_required', 400),
  insufficientDeposit: () => new AppException('insufficient_deposit', 422),
  walletNotFound: () => new AppException('wallet_not_found', 404),
  ledgerUnbalanced: () => new AppException('ledger_unbalanced', 500),
  fileTooLarge: (maxKb: number) => new AppException('file_too_large', 413, { maxKb }),
  fileTypeNotAllowed: () => new AppException('file_type_not_allowed', 415),
  uploadFailed: () => new AppException('upload_failed', 502),
  uploadNotFound: () => new AppException('upload_not_found', 404),
  invalidPin: () => new AppException('pin_invalid', 401),
};
