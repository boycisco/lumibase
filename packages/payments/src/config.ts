/**
 * Payment service configuration.
 *
 * The service receives its dependencies explicitly rather than reaching for
 * process-level singletons. Two dependencies are injectable on purpose:
 *
 *   - `clock`: tests need to control "now" to verify expiration and
 *     created/updated timestamps. Production uses `() => new Date()`.
 *
 *   - `idGenerator`: tests need predictable UUIDs. Production uses
 *     `crypto.randomUUID()`. The DB column has a `gen_random_uuid()` default
 *     for cases where an ID is inserted without one (e.g., migrations), but
 *     the service always supplies the ID explicitly so it can construct the
 *     full Payment object before hitting the database.
 */

import type { Database } from '@lumibase/database';
import type { NetworkConfig } from '@lumibase/network';

/**
 * Configuration accepted by the createPaymentService factory.
 *
 * `clock` and `idGenerator` are optional; safe defaults are applied by
 * resolveConfig().
 */
export interface PaymentConfig {
  readonly db: Database;
  readonly chains: NetworkConfig;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
}

/**
 * Configuration after defaults have been applied. `clock` and `idGenerator`
 * are always present.
 */
export interface ResolvedConfig {
  readonly db: Database;
  readonly chains: NetworkConfig;
  readonly clock: () => Date;
  readonly idGenerator: () => string;
}

function defaultClock(): Date {
  return new Date();
}

function defaultIdGenerator(): string {
  return crypto.randomUUID();
}

/**
 * Apply defaults to a PaymentConfig. Idempotent — calling twice produces
 * equivalent behavior (though distinct closure instances).
 */
export function resolveConfig(config: PaymentConfig): ResolvedConfig {
  return {
    db: config.db,
    chains: config.chains,
    clock: config.clock ?? defaultClock,
    idGenerator: config.idGenerator ?? defaultIdGenerator,
  };
}
