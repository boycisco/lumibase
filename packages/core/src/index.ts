/**
 * LumiBase Core
 *
 * Shared foundational utilities consumed by every LumiBase module.
 *
 * Language-independent specifications live in the repository's `specs/`
 * directory. This package is the TypeScript reference implementation.
 */

export {
  MAX_UINT256,
  deserializeAmount,
  formatUnits,
  parseUnits,
  serializeAmount,
} from './amount.js';

export {
  HTTP_STATUS,
  LumiError,
  conflictError,
  internalError,
  isLumiError,
  notFoundError,
  unauthorizedError,
  validationError,
} from './error.js';

export type { CoreErrorCode, ErrorBody, ErrorOptions } from './error.js';

export const VERSION = '0.1.0';
