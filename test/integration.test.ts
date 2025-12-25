import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  closePersistentBrowser,
  resetBrowserState,
  setProfileDir,
  getProfileDir,
} from '../src/browser-manager.js';
import { createServer } from '../src/index.js';

const TEST_PROFILE_DIR = path.join(
  os.tmpdir(),
  `pptr-mcp-integration-${crypto.randomUUID()}`
);

interface TabScreenshot {
  pageId: string;
  url: string;
  path: string;
}

interface ExecutionResponse {
  success: boolean;
  result?: unknown;
  error?: string;
  details?: {
    type: string;
    stack?: string;
    suggestion?: string;
  };
  logs: { level: string; args: unknown[] }[];
  screenshots: TabScreenshot[];
}

function parseResponse(content: unknown[]): ExecutionResponse {
  const textContent = content[0] as { type: string; text: string };

  return JSON.parse(textContent.text) as ExecutionResponse;
}

// noop logger for tests - avoids MCP logging noise
const noop = () => {};
const noopLogger = {
  debug: noop,
  info: noop,
  warning: noop,
  error: noop,
};

void describe('integration', () => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const { server } = createServer(noopLogger);

  before(async () => {
    setProfileDir(TEST_PROFILE_DIR);
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  after(async () => {
    await closePersistentBrowser();
    resetBrowserState();
    await client.close();
    await server.close();
    await fs.rm(TEST_PROFILE_DIR, { recursive: true, force: true });
  });

  void it('executes valid code and returns success', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: { code: 'return 42', persistent: true },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, true);
    assert.strictEqual(response.result, 42);
  });

  void it('returns structured error for syntax errors', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: { code: 'return {{{', persistent: true },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, false);
    assert.strictEqual(response.details?.type, 'syntax');
  });

  void it('returns structured error for runtime errors', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: { code: 'throw new Error("test error")', persistent: true },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, false);
    assert.strictEqual(response.details?.type, 'runtime');
    assert.ok(response.error?.includes('test error'));
  });

  void it('persistent mode reuses browser', async () => {
    // use process.pid to verify same browser instance
    const result1 = await client.callTool({
      name: 'execute',
      arguments: {
        code: 'return browser.process()?.pid',
        persistent: true,
      },
    });
    const response1 = parseResponse(result1.content as unknown[]);

    assert.strictEqual(response1.success, true);

    const result2 = await client.callTool({
      name: 'execute',
      arguments: {
        code: 'return browser.process()?.pid',
        persistent: true,
      },
    });
    const response2 = parseResponse(result2.content as unknown[]);

    assert.strictEqual(response2.success, true);

    assert.strictEqual(
      response1.result,
      response2.result,
      'should reuse same browser (same process ID)'
    );
  });

  void it('includes console logs in response', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          console.log('hello');
          console.error('error');
          return 'done';
        `,
        persistent: true,
      },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, true);
    assert.ok(response.logs.length >= 2, 'should have logs');

    const logEntry = response.logs.find((l) => l.args.includes('hello'));

    assert.ok(logEntry, 'should include hello log');
  });

  void it('returns timeout error when execution exceeds limit', async () => {
    const originalTimeout = process.env['PPTR_MCP_TIMEOUT'];

    process.env['PPTR_MCP_TIMEOUT'] = '500';

    try {
      const result = await client.callTool({
        name: 'execute',
        arguments: {
          code: 'await new Promise(() => {})',
          persistent: true,
        },
      });

      const response = parseResponse(result.content as unknown[]);

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.details?.type, 'timeout');
    } finally {
      if (originalTimeout === undefined) {
        delete process.env['PPTR_MCP_TIMEOUT'];
      } else {
        process.env['PPTR_MCP_TIMEOUT'] = originalTimeout;
      }
    }
  });

  void it('handles circular object serialization', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          const obj = { a: 1 };
          obj.self = obj;
          return obj;
        `,
        persistent: true,
      },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, true);
    assert.ok(
      typeof response.result === 'string',
      'circular should be stringified'
    );
  });

  void it('concurrent persistent calls are serialized (mutex)', async () => {
    const executionOrder: number[] = [];

    const call = async (id: number, delayMs: number) => {
      const result = await client.callTool({
        name: 'execute',
        arguments: {
          code: `
            await new Promise(r => setTimeout(r, ${String(delayMs)}));
            return ${String(id)};
          `,
          persistent: true,
        },
      });
      const response = parseResponse(result.content as unknown[]);

      if (response.success) {
        executionOrder.push(response.result as number);
      }

      return response;
    };

    // launch 3 calls concurrently with different delays
    // if not serialized, call 3 (10ms) would finish before call 1 (50ms)
    const [r1, r2, r3] = await Promise.all([
      call(1, 50),
      call(2, 30),
      call(3, 10),
    ]);

    assert.strictEqual(r1.success, true);
    assert.strictEqual(r2.success, true);
    assert.strictEqual(r3.success, true);

    // with mutex, execution order should be 1, 2, 3 (launch order)
    assert.deepStrictEqual(
      executionOrder,
      [1, 2, 3],
      'calls should execute in launch order due to mutex'
    );
  });

  void it('persistent=true shares cookies between calls', async () => {
    // set cookie
    const setResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          const page = await browser.newPage();
          await page.goto('https://example.com');
          await page.evaluate(() => document.cookie = 'persistTest=hello; path=/');
          return 'set';
        `,
        persistent: true,
      },
    });

    assert.strictEqual(
      parseResponse(setResult.content as unknown[]).success,
      true
    );

    // read cookie in second call
    const getResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          const page = await browser.newPage();
          await page.goto('https://example.com');
          return await page.evaluate(() => document.cookie);
        `,
        persistent: true,
      },
    });
    const getResponse = parseResponse(getResult.content as unknown[]);

    assert.strictEqual(getResponse.success, true);
    assert.ok(
      (getResponse.result as string).includes('persistTest=hello'),
      'cookies should persist in persistent mode'
    );
  });

  void it('isolated mode (persistent=false) uses fresh browser each call', async () => {
    const result1 = await client.callTool({
      name: 'execute',
      arguments: {
        code: 'return browser.process()?.pid',
        persistent: false,
      },
    });
    const response1 = parseResponse(result1.content as unknown[]);

    assert.strictEqual(response1.success, true);

    const result2 = await client.callTool({
      name: 'execute',
      arguments: {
        code: 'return browser.process()?.pid',
        persistent: false,
      },
    });
    const response2 = parseResponse(result2.content as unknown[]);

    assert.strictEqual(response2.success, true);

    assert.notStrictEqual(
      response1.result,
      response2.result,
      'isolated mode should use different browser instances (different PIDs)'
    );
  });

  void it('isolated mode does not share cookies with persistent mode', async () => {
    // set cookie in persistent mode
    const setResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          const page = await browser.newPage();
          await page.goto('https://example.com');
          await page.evaluate(() => document.cookie = 'sharedTest=persistent; path=/');
          return 'set';
        `,
        persistent: true,
      },
    });

    assert.strictEqual(
      parseResponse(setResult.content as unknown[]).success,
      true
    );

    // read cookie in isolated mode - should NOT see persistent cookie
    const getResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          const page = await browser.newPage();
          await page.goto('https://example.com');
          return await page.evaluate(() => document.cookie);
        `,
        persistent: false,
      },
    });
    const getResponse = parseResponse(getResult.content as unknown[]);

    assert.strictEqual(getResponse.success, true);
    assert.ok(
      !(getResponse.result as string).includes('sharedTest=persistent'),
      'isolated mode should not see persistent mode cookies'
    );
  });

  void it('persistent mode preserves cookies across browser relaunch', async () => {
    // clean profile before test
    const profileDir = await getProfileDir();

    await fs.rm(profileDir, { recursive: true, force: true });

    // close any existing persistent browser
    await closePersistentBrowser();

    // set persistent cookie (with expires) in persistent browser
    const setResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          const page = await browser.newPage();
          await page.goto('https://example.com');
          // set cookie with expiration (session cookies are not persisted to disk)
          const expires = new Date(Date.now() + 86400000).toUTCString();
          await page.evaluate((exp) => {
            document.cookie = 'test=relaunch; path=/; expires=' + exp;
          }, expires);
          return 'cookie set';
        `,
        persistent: true,
      },
    });

    assert.strictEqual(
      parseResponse(setResult.content as unknown[]).success,
      true
    );

    // close browser to simulate relaunch
    await closePersistentBrowser();

    // read cookie after relaunch
    const getResult = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          const page = await browser.newPage();
          await page.goto('https://example.com');
          return await page.evaluate(() => document.cookie);
        `,
        persistent: true,
      },
    });
    const getResponse = parseResponse(getResult.content as unknown[]);

    assert.strictEqual(getResponse.success, true);
    assert.ok(
      (getResponse.result as string).includes('test=relaunch'),
      'cookie should persist after browser relaunch'
    );
  });

  void it('response includes screenshots array on success', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          const page = await browser.newPage();
          await page.goto('about:blank');
          return 'done';
        `,
        persistent: true,
      },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, true);
    assert.ok(
      Array.isArray(response.screenshots),
      'should have screenshots array'
    );
    assert.ok(
      response.screenshots.length > 0,
      'should have at least one screenshot'
    );

    const [screenshot] = response.screenshots;

    assert.ok(screenshot, 'should have screenshot entry');
    assert.ok(screenshot.pageId, 'should have pageId');
    assert.ok(screenshot.url, 'should have url');
    assert.ok(screenshot.path, 'should have path');

    for (const s of response.screenshots) {
      await fs.unlink(s.path).catch(() => {});
    }
  });

  void it('response includes screenshots array on error', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          const page = await browser.newPage();
          await page.goto('about:blank');
          throw new Error('test error');
        `,
        persistent: true,
      },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, false);
    assert.ok(
      Array.isArray(response.screenshots),
      'should have screenshots array'
    );
    assert.ok(
      response.screenshots.length > 0,
      'should capture screenshot even on error'
    );

    for (const s of response.screenshots) {
      await fs.unlink(s.path).catch(() => {});
    }
  });

  void it('response has screenshots: [] when all pages closed', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          const pages = await browser.pages();
          for (const page of pages) {
            await page.close();
          }
          return 'all closed';
        `,
        persistent: true,
      },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, true);
    assert.deepStrictEqual(response.screenshots, []);
  });

  void it('multiple tabs produce multiple screenshot entries', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: {
        code: `
          const pages = await browser.pages();
          for (const page of pages) {
            await page.close();
          }
          await browser.newPage();
          await browser.newPage();
          return 'two tabs';
        `,
        persistent: true,
      },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, true);
    assert.strictEqual(
      response.screenshots.length,
      2,
      'should have 2 screenshots'
    );

    for (const s of response.screenshots) {
      await fs.unlink(s.path).catch(() => {});
    }
  });
});
