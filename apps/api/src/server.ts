/**
 * Production server entry point.
 *
 * Loads config, opens the DB pool, builds the app, and starts listening.
 * Registers SIGINT and SIGTERM handlers so container shutdowns are clean:
 * the HTTP server stops accepting new connections, in-flight requests
 * finish, the DB pool drains, then the process exits.
 *
 * Not exported from index.ts — this file has side effects (network listen,
 * signal handlers) and should only run as a process, never be imported.
 */

import { createClient } from '@lumibase/database';
import { loadNetworkConfig } from '@lumibase/network';
import { buildApp } from './app.ts';
import { loadApiConfig } from './config.ts';

async function main(): Promise<void> {
  const config = loadApiConfig();
  const chains = loadNetworkConfig(process.env);
  const client = createClient(config.databaseUrl);

  const app = await buildApp({ config, db: client.db, chains });

  app.log.info(
    {
      port: config.port,
      nodeEnv: config.nodeEnv,
      chains: [...chains.chains.keys()],
    },
    'api_starting',
  );

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutdown_starting');
    try {
      await app.close();
      await client.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'shutdown_failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error({ err }, 'api_start_failed');
    await client.close();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
