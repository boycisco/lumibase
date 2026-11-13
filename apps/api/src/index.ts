/**
 * @lumibase/api — public exports.
 *
 * The server entry point is `server.ts` (not exported here). Everything
 * exported from `index.ts` is what tests and future consumers need to
 * build apps and validate behavior.
 */

export { buildApp } from './app.ts';
export type { AppDeps } from './app.ts';
export { registerApplication } from './application.ts';
export { hashApiKey, requireAdminAuth, requireAppAuth } from './auth.ts';
export { loadApiConfig } from './config.ts';
export type { ApiConfig } from './config.ts';
export { setErrorHandler } from './error.ts';
export { registerHealth } from './health.ts';
export { registerRoutes } from './routes.ts';

export const VERSION = '0.1.0';
