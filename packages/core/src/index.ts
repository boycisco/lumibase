/**
 * LumiBase Core
 *
 * Shared foundational utilities consumed by every LumiBase module.
 *
 * Language-independent specifications live in the repository's `specs/`
 * directory. This package is the TypeScript reference implementation.
 */

export { assertAddress, checksumAddress, isAddress, normalizeAddress } from './address.js';

export {
  MAX_UINT256,
  deserializeAmount,
  formatUnits,
  parseUnits,
  serializeAmount,
} from './amount.js';

export { assertChain, assertChainId, assertEnabled } from './chain.js';
export type { ChainConfig, ConfirmationPolicy, NativeCurrency } from './chain.js';

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
