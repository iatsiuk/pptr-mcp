#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ensureBrowserInstalled } from './browser-installer.js';
import {
  setLaunchArgs,
  closePersistentBrowser,
  waitForPersistentIdle,
  cleanupOldResults,
} from './browser-manager.js';
import { server, log } from './index.js';

const SHUTDOWN_TIMEOUT_MS = 5_000;

let shuttingDown = false;

async function gracefulShutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info('server', { status: 'shutting-down', reason });

  await Promise.race([
    (async () => {
      await waitForPersistentIdle().catch(() => {
        // ignore - best effort
      });
      await closePersistentBrowser().catch(() => {
        // ignore - best effort
      });
    })(),
    new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
  ]);

  process.exit(0);
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.stdin.on('end', () => void gracefulShutdown('stdin-end'));

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    setLaunchArgs(args);
  }

  const transport = new StdioServerTransport();

  await server.connect(transport);

  log.info('server', { status: 'started', chromeArgs: args });

  // start browser installation in background (fire-and-forget)
  log.info('browser', { status: 'checking' });
  ensureBrowserInstalled()
    .then(() => {
      log.info('browser', { status: 'ready' });
    })
    .catch((err: unknown) => {
      log.warning('browser', {
        status: 'download-failed',
        error: String(err),
      });
    });

  // cleanup old result files (fire-and-forget)
  cleanupOldResults().catch(() => {
    // ignore - best effort cleanup
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);

  console.error(`pptr-mcp failed to start: ${message}`);
  process.exit(1);
});
