#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setLaunchArgs } from './browser-manager.js';
import { server, log } from './index.js';

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    setLaunchArgs(args);
  }

  const transport = new StdioServerTransport();

  await server.connect(transport);
  log.info('server', { status: 'started', chromeArgs: args });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);

  console.error(`pptr-mcp failed to start: ${message}`);
  process.exit(1);
});
