/**
 * Structured error primitive used throughout LumiBase.
 *
 * Every error that crosses an API boundary is a LumiError so it can be
 * serialized into the wire shape defined in specs/payments/errors.json:
 *
 *   { "error": { "code": "...", "message": "...", "requestId": "..." } }
 *
 * Core only defines cross-cutting codes every module can emit. Module
 * packages (payments, wallet, ...) may add their own code strings without
 * changing this file; the CoreErrorCode type deliberately allows that.
 */

/** HTTP status codes we reference. Keeping them here avoids magic numbers. */
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UNAVAILABLE: 503,
} as const;

/**
 * Cross-cutting error codes every module can emit.
 *
 * The `(string & {})` tail is a documented TypeScript idiom that allows
 * module-specific codes to be used here while still giving autocomplete
 * for the well-known ones. Do not remove it.
 */
export type CoreErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CONFIG_ERROR'
  | 'INTERNAL_ERROR'
  | (string & {});

/** Wire shape of an error response body. */
export interface ErrorBody {
  code: string;
  message: string;
  requestId?: string;
}

export interface ErrorOptions {
  statusCode?: number;
  details?: unknown;
  cause?: unknown;
}

/**
 * The only error class LumiBase code should throw.
 *
 * Anything else caught at an API boundary is treated as an internal error
 * with no leaked details.
 */
export class LumiError extends Error {
  readonly code: CoreErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: CoreErrorCode, message: string, options: ErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'LumiError';
    this.code = code;
    this.statusCode = options.statusCode ?? HTTP_STATUS.INTERNAL;
    this.details = options.details;
  }

  /**
   * Produce the safe wire format.
   *
   * Details are NEVER included here. If you need to expose details to a
   * client, do so in a future, explicitly-reviewed method. This default is
   * the conservative one on purpose.
   */
  toBody(requestId?: string): ErrorBody {
    const body: ErrorBody = { code: this.code, message: this.message };
    if (requestId !== undefined) body.requestId = requestId;
    return body;
  }
}

export function isLumiError(err: unknown): err is LumiError {
  return err instanceof LumiError;
}

export function validationError(message: string, details?: unknown): LumiError {
  return new LumiError('VALIDATION_ERROR', message, {
    statusCode: HTTP_STATUS.BAD_REQUEST,
    details,
  });
}

export function notFoundError(message: string, details?: unknown): LumiError {
  return new LumiError('NOT_FOUND', message, {
    statusCode: HTTP_STATUS.NOT_FOUND,
    details,
  });
}

export function unauthorizedError(message: string, details?: unknown): LumiError {
  return new LumiError('UNAUTHORIZED', message, {
    statusCode: HTTP_STATUS.UNAUTHORIZED,
    details,
  });
}

export function conflictError(message: string, details?: unknown): LumiError {
  return new LumiError('CONFLICT', message, {
    statusCode: HTTP_STATUS.CONFLICT,
    details,
  });
}

export function internalError(message: string, details?: unknown): LumiError {
  return new LumiError('INTERNAL_ERROR', message, {
    statusCode: HTTP_STATUS.INTERNAL,
    details,
  });
}
