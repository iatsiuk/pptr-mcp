import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  closePersistentBrowser,
  resetBrowserState,
} from '../src/browser-manager.js';
import { createServer } from '../src/index.js';

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
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  after(async () => {
    await closePersistentBrowser();
    resetBrowserState();
    await client.close();
    await server.close();
  });

  void it('executes valid code and returns success', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: { code: 'return 42', persistent: false },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, true);
    assert.strictEqual(response.result, 42);
  });

  void it('returns structured error for syntax errors', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: { code: 'return {{{', persistent: false },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, false);
    assert.strictEqual(response.details?.type, 'syntax');
  });

  void it('returns structured error for runtime errors', async () => {
    const result = await client.callTool({
      name: 'execute',
      arguments: { code: 'throw new Error("test error")', persistent: false },
    });

    const response = parseResponse(result.content as unknown[]);

    assert.strictEqual(response.success, false);
    assert.strictEqual(response.details?.type, 'runtime');
    assert.ok(response.error?.includes('test error'));
  });

  void it('persistent mode reuses browser', async () => {
    const result1 = await client.callTool({
      name: 'execute',
      arguments: {
        code: 'return browser.wsEndpoint()',
        persistent: true,
      },
    });
    const response1 = parseResponse(result1.content as unknown[]);

    assert.strictEqual(response1.success, true);

    const result2 = await client.callTool({
      name: 'execute',
      arguments: {
        code: 'return browser.wsEndpoint()',
        persistent: true,
      },
    });
    const response2 = parseResponse(result2.content as unknown[]);

    assert.strictEqual(response2.success, true);

    assert.strictEqual(
      response1.result,
      response2.result,
      'should reuse same browser'
    );
  });

  void it('non-persistent mode uses fresh browser each call', async () => {
    const result1 = await client.callTool({
      name: 'execute',
      arguments: {
        code: 'return browser.wsEndpoint()',
        persistent: false,
      },
    });
    const response1 = parseResponse(result1.content as unknown[]);

    assert.strictEqual(response1.success, true);

    const result2 = await client.callTool({
      name: 'execute',
      arguments: {
        code: 'return browser.wsEndpoint()',
        persistent: false,
      },
    });
    const response2 = parseResponse(result2.content as unknown[]);

    assert.strictEqual(response2.success, true);

    assert.notStrictEqual(
      response1.result,
      response2.result,
      'should use fresh browser'
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
        persistent: false,
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
          persistent: false,
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

  void it('zombie page test: multiple calls with newPage do not leak', async () => {
    const getPageCount = async () => {
      const result = await client.callTool({
        name: 'execute',
        arguments: {
          code: 'return (await browser.pages()).length',
          persistent: true,
        },
      });
      const response = parseResponse(result.content as unknown[]);

      return response.result as number;
    };

    const initialCount = await getPageCount();

    for (let i = 0; i < 5; i++) {
      await client.callTool({
        name: 'execute',
        arguments: {
          code: `
            const page = await browser.newPage();
            await page.setContent('<h1>Test</h1>');
            return 'created page';
          `,
          persistent: true,
        },
      });
    }

    const finalCount = await getPageCount();

    assert.strictEqual(
      finalCount,
      initialCount,
      'page count should not increase'
    );
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
        persistent: false,
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
});
