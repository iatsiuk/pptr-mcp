import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Browser } from 'puppeteer-core';
import pptrPkg from 'puppeteer-core/package.json' with { type: 'json' };
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import { getInstallStatus } from './browser-installer.js';
import {
  getPersistentBrowser,
  launchBrowser,
  createErrorResponse,
  withPersistentLock,
  getLaunchErrorSuggestion,
} from './browser-manager.js';
import { createLogger, type Logger } from './logger.js';
import { executeDescription } from './tool-descriptions.js';
import { executeCode } from './vm-executor.js';

const DEFAULT_TIMEOUT = 30000;

interface ServerWithLogger {
  server: McpServer;
  log: Logger;
}

export function createServer(logger?: Logger): ServerWithLogger {
  const server = new McpServer(
    { name: pkg.name, version: pkg.version },
    { capabilities: { logging: {} } }
  );

  const log = logger ?? createLogger(server);

  server.registerTool(
    'execute',
    {
      description: executeDescription.replace(
        '<%= version %>',
        pptrPkg.version
      ),
      inputSchema: {
        code: z
          .string()
          .describe(
            'JavaScript code to execute. Return JSON-serializable data'
          ),
        persistent: z
          .boolean()
          .default(true)
          .describe(
            'Reuse browser profile across calls; false creates isolated profile per call'
          ),
      },
    },
    async ({ code, persistent }) => {
      const status = getInstallStatus();

      if (status.installing) {
        return {
          content: [
            {
              type: 'text',
              text: `Chrome browser is being downloaded (${String(status.progress)}% complete). Please retry in a couple of minutes.`,
            },
          ],
          isError: true,
        };
      }

      const timeout = parseInt(
        process.env['PPTR_MCP_TIMEOUT'] ?? String(DEFAULT_TIMEOUT),
        10
      );

      log.info('execute', {
        codeLength: code.length,
        mode: persistent ? 'persistent' : 'isolated',
      });

      let browser: Browser;

      try {
        browser = persistent
          ? await getPersistentBrowser()
          : await launchBrowser();
      } catch (err) {
        const response = createErrorResponse(
          'launch',
          err instanceof Error ? err.message : String(err),
          getLaunchErrorSuggestion(err)
        );

        return {
          content: [{ type: 'text', text: JSON.stringify(response) }],
          isError: true,
        };
      }

      const execute = () => executeCode(code, browser, timeout);

      try {
        const response = persistent
          ? await withPersistentLock(execute)
          : await execute();

        return {
          content: [{ type: 'text', text: JSON.stringify(response) }],
          isError: !response.success,
        };
      } finally {
        if (!persistent) {
          await browser.close().catch(() => {
            // ignore close errors for isolated browser
          });
        }
      }
    }
  );

  return { server, log };
}

export const { server, log } = createServer();
