import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const noop = () => {
  // intentionally empty
};
const noopLogger = {
  debug: noop,
  info: noop,
  warning: noop,
  error: noop,
};

void describe('execute tool install status check', () => {
  void it('returns download message when browser is installing', async () => {
    // mock module before importing index.js
    mock.module('../src/browser-installer.js', {
      namedExports: {
        getInstallStatus: () => ({ installing: true, progress: 42 }),
        ensureBrowserInstalled: () => Promise.resolve('/path/to/chrome'),
        getCacheDir: () => '/cache',
        resetInstallerState: () => {
          // mock - intentionally empty
        },
      },
    });

    // dynamic import to get mocked version
    const { createServer } = await import('../src/index.js');
    const { server } = createServer(noopLogger);

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: 'execute',
        arguments: { code: 'return 1', persistent: false },
      });

      const content = result.content as { type: string; text: string }[];
      const [first] = content;
      const text = first?.text ?? '';

      assert.strictEqual(result.isError, true);
      assert.ok(text.includes('42%'), 'should include progress percentage');
      assert.ok(text.includes('download'), 'should mention downloading');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
