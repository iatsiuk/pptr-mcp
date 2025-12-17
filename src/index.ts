import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Browser } from 'puppeteer-core';
import pptrPkg from 'puppeteer-core/package.json' with { type: 'json' };
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import {
  getPersistentBrowser,
  launchBrowser,
  closeBrowser,
  getProfilePath,
  cleanupProfile,
  createErrorResponse,
} from './browser-manager.js';
import { createLogger, type Logger } from './logger.js';
import { executeDescription } from './tool-descriptions.js';
import { executeCode } from './vm-executor.js';

const DEFAULT_TIMEOUT = 30000;

export function createServer(logger?: Logger): McpServer {
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
      const profilePath = getProfilePath(persistent);
      const timeout = parseInt(
        process.env['PPTR_MCP_TIMEOUT'] ?? String(DEFAULT_TIMEOUT),
        10
      );

      log.info('execute', { codeLength: code.length, persistent, profilePath });

      let browser: Browser;

      try {
        browser = persistent
          ? await getPersistentBrowser()
          : await launchBrowser(profilePath);
      } catch (err) {
        const response = createErrorResponse(
          'launch',
          err instanceof Error ? err.message : String(err),
          'Check Chrome installation or set CHROME_PATH'
        );

        return {
          content: [{ type: 'text', text: JSON.stringify(response) }],
          isError: true,
        };
      }

      try {
        const response = await executeCode(code, browser, timeout);

        return {
          content: [{ type: 'text', text: JSON.stringify(response) }],
          isError: !response.success,
        };
      } finally {
        if (!persistent) {
          await closeBrowser(browser, persistent).catch((err: unknown) => {
            log.warning('closeBrowser', { error: String(err) });
          });
          await cleanupProfile(profilePath);
        }
      }
    }
  );

  return server;
}

export const server = createServer();
export const log = createLogger(server);
