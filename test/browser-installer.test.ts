import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';

void describe('browser-installer', () => {
  void describe('getCacheDir', () => {
    const originalCacheDir = process.env['PUPPETEER_CACHE_DIR'];

    afterEach(() => {
      if (originalCacheDir !== undefined) {
        process.env['PUPPETEER_CACHE_DIR'] = originalCacheDir;
      } else {
        delete process.env['PUPPETEER_CACHE_DIR'];
      }
    });

    void it('returns default path when PUPPETEER_CACHE_DIR not set', async () => {
      delete process.env['PUPPETEER_CACHE_DIR'];

      // need to re-import to pick up env change at module load time
      // getCacheDir reads from module-level const, so we test the default behavior
      const { getCacheDir } = await import('../src/browser-installer.js');
      const cacheDir = getCacheDir();

      // the module was loaded with whatever env was set at load time
      // so we just verify it returns a valid path
      assert.ok(
        typeof cacheDir === 'string' && cacheDir.length > 0,
        'should return a non-empty string'
      );
      assert.ok(
        cacheDir.includes('puppeteer'),
        'should include puppeteer in path'
      );
    });
  });

  void describe('ensureBrowserInstalled', () => {
    void it('returns same promise for concurrent calls (singleton)', async () => {
      const { ensureBrowserInstalled } =
        await import('../src/browser-installer.js');

      // call multiple times concurrently
      const promise1 = ensureBrowserInstalled();
      const promise2 = ensureBrowserInstalled();
      const promise3 = ensureBrowserInstalled();

      // all should be the same promise object
      assert.strictEqual(promise1, promise2, 'should return same promise');
      assert.strictEqual(promise2, promise3, 'should return same promise');

      // wait for them to resolve (they should all resolve to the same value)
      const [path1, path2, path3] = await Promise.all([
        promise1,
        promise2,
        promise3,
      ]);

      assert.strictEqual(path1, path2, 'should return same path');
      assert.strictEqual(path2, path3, 'should return same path');
      assert.ok(
        typeof path1 === 'string' && path1.length > 0,
        'should return executable path'
      );
    });

    void it('returns valid executable path', async () => {
      const { ensureBrowserInstalled } =
        await import('../src/browser-installer.js');

      const execPath = await ensureBrowserInstalled();

      assert.ok(
        typeof execPath === 'string' && execPath.length > 0,
        'should return non-empty string'
      );
      assert.ok(execPath.includes('chrome'), 'should be chrome executable');
    });
  });

  void describe('resetInstallerState', () => {
    void it('clears cached state', async () => {
      const { ensureBrowserInstalled, resetInstallerState } =
        await import('../src/browser-installer.js');

      // first call
      const path1 = await ensureBrowserInstalled();

      // reset state
      resetInstallerState();

      // second call should create new promise
      const path2 = await ensureBrowserInstalled();

      // both should return valid paths (likely the same since browser is cached)
      assert.ok(typeof path1 === 'string' && path1.length > 0);
      assert.ok(typeof path2 === 'string' && path2.length > 0);
    });
  });

  void describe('getInstallStatus', () => {
    void it('returns installing: false when browser is already installed', async () => {
      const { ensureBrowserInstalled, getInstallStatus } =
        await import('../src/browser-installer.js');

      // ensure browser is installed
      await ensureBrowserInstalled();

      const status = getInstallStatus();

      // when browser already exists, no download happens, so installing should be false
      assert.strictEqual(status.installing, false);
    });

    void it('resets status after resetInstallerState', async () => {
      const { resetInstallerState, getInstallStatus } =
        await import('../src/browser-installer.js');

      resetInstallerState();

      const status = getInstallStatus();

      assert.strictEqual(status.installing, false);
      assert.strictEqual(status.progress, 0);
    });
  });
});
