#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ensureBrowserInstalled } from './browser-installer.ts';
import {
  setBrowserConfig,
  closePersistentBrowser,
  waitForPersistentIdle,
} from './browser-manager.ts';
import { parseArgs, HELP_TEXT } from './cli-args.ts';
import { server, log } from './index.ts';

const SHUTDOWN_TIMEOUT_MS = 5_000;

let shuttingDown = false;

async function gracefulShutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  log.info('server', { status: 'shutting-down', reason });

  await Promise.race([
    (async () => {
      await waitForPersistentIdle().catch(() => {});
      await closePersistentBrowser().catch(() => {});
    })(),
    new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
  ]);

  process.exit(0);
}

process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.stdin.on('end', () => void gracefulShutdown('stdin-end'));

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (options.viewportRaw && !options.viewport) {
    console.error(
      `warning: invalid viewport format "${options.viewportRaw}", expected WxH (e.g., 1920x1080)`
    );
  }

  setBrowserConfig(options);

  const transport = new StdioServerTransport();

  await server.connect(transport);

  log.info('server', {
    status: 'started',
    headless: options.headless,
    viewport: options.viewport,
    chromeArgs: options.chromeArgs,
  });

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
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);

  console.error(`pptr-mcp failed to start: ${message}`);
  process.exit(1);
});
