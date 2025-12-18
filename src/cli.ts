#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ensureBrowserInstalled } from './browser-installer.js';
import { setLaunchArgs } from './browser-manager.js';
import { server, log } from './index.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    setLaunchArgs(args);
  }

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

  const transport = new StdioServerTransport();

  await server.connect(transport);
  log.info('server', { status: 'started', chromeArgs: args });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);

  console.error(`pptr-mcp failed to start: ${message}`);
  process.exit(1);
});
