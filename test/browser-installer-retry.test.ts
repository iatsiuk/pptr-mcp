import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

void describe('browser-installer retry on failure', () => {
  void it('auto-resets promise on rejection allowing retry', async () => {
    let callCount = 0;

    mock.module('@puppeteer/browsers', {
      namedExports: {
        Browser: { CHROME: 'chrome' },
        detectBrowserPlatform: () => 'darwin',
        getInstalledBrowsers: () => Promise.resolve([]),
        resolveBuildId: () => Promise.resolve('test-build-id'),
        computeExecutablePath: () => '/path/to/chrome',
        install: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error('Network error'));
          }
          return Promise.resolve({ executablePath: '/path/to/chrome' });
        },
      },
    });

    const { ensureBrowserInstalled } =
      await import('../src/browser-installer.js');

    // first call should fail
    const firstResult = await ensureBrowserInstalled().then(
      (path) => ({ ok: true, path }),
      (err: unknown) => ({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    );

    assert.deepStrictEqual(firstResult, { ok: false, error: 'Network error' });

    // KEY BEHAVIOR: without any manual reset, second call should
    // create a NEW promise and succeed (because promise auto-resets on rejection)
    const secondResult = await ensureBrowserInstalled().then(
      (path) => ({ ok: true, path }),
      (err: unknown) => ({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    );

    assert.deepStrictEqual(secondResult, { ok: true, path: '/path/to/chrome' });
    assert.strictEqual(callCount, 2, 'install should be called twice');
  });
});
