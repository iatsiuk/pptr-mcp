import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { createLogger } from '../src/logger.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function createMockServer() {
  const sendLoggingMessage = mock.fn();

  return {
    mock: sendLoggingMessage,
    server: {
      server: { sendLoggingMessage },
    } as unknown as McpServer,
  };
}

void describe('createLogger', () => {
  void it('sends message with correct level for each method', () => {
    const levels = ['debug', 'info', 'warning', 'error'] as const;

    for (const level of levels) {
      const { server, mock: sendMock } = createMockServer();
      const logger = createLogger(server);

      logger[level]('test-logger', { data: 'value' });

      assert.strictEqual(sendMock.mock.calls.length, 1);
      assert.deepStrictEqual(sendMock.mock.calls[0]?.arguments, [
        { level, logger: 'test-logger', data: { data: 'value' } },
      ]);
    }
  });
});
