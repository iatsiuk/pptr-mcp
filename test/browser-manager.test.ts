import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  launchBrowser,
  getPersistentBrowser,
  closePersistentBrowser,
  resetBrowserState,
  setBrowserConfig,
  isProfileLockError,
  getLaunchErrorSuggestion,
} from '../src/browser-manager.js';
import { saveResultToFile } from '../src/vm-executor.js';

void describe('browser-manager', () => {
  afterEach(async () => {
    await closePersistentBrowser();
    resetBrowserState();
  });

  void describe('setBrowserConfig', () => {
    void it('applies viewport config to launched browser', async () => {
      setBrowserConfig({
        headless: true,
        viewport: { width: 800, height: 600 },
      });

      const browser = await launchBrowser();

      try {
        const page = await browser.newPage();
        const viewport = page.viewport();

        assert.strictEqual(viewport?.width, 800);
        assert.strictEqual(viewport.height, 600);
      } finally {
        await browser.close();
      }
    });
  });

  void describe('launchBrowser', () => {
    void it('creates browser instance', async () => {
      const browser = await launchBrowser();

      try {
        assert.ok(browser.connected, 'browser should be connected');
      } finally {
        await browser.close();
      }
    });

    void it('creates browser with custom profile path', async () => {
      const customPath = path.join(
        os.tmpdir(),
        `pptr-mcp-test-profile-${crypto.randomUUID()}`
      );
      const browser = await launchBrowser(customPath);

      try {
        assert.ok(browser.connected, 'browser should be connected');
      } finally {
        await browser.close();
        // direct cleanup - test profile is outside managed directory
        await fs.rm(customPath, { recursive: true, force: true });
      }
    });
  });

  void describe('getPersistentBrowser', () => {
    void it('returns connected browser instance', async () => {
      const browser = await getPersistentBrowser();

      assert.ok(browser.connected, 'browser should be connected');
    });

    void it('returns same instance on multiple calls', async () => {
      const browser1 = await getPersistentBrowser();
      const browser2 = await getPersistentBrowser();

      assert.strictEqual(
        browser1.wsEndpoint(),
        browser2.wsEndpoint(),
        'should be same browser instance'
      );
    });

    void it('relaunches if browser disconnected', async () => {
      const browser1 = await getPersistentBrowser();

      await browser1.close();

      assert.ok(!browser1.connected, 'old browser should be disconnected');

      const browser2 = await getPersistentBrowser();

      assert.ok(browser2.connected, 'new browser should be connected');
    });

    void it('concurrent calls do not double-launch (mutex)', async () => {
      const [browser1, browser2, browser3] = await Promise.all([
        getPersistentBrowser(),
        getPersistentBrowser(),
        getPersistentBrowser(),
      ]);

      const endpoint1 = browser1.wsEndpoint();
      const endpoint2 = browser2.wsEndpoint();
      const endpoint3 = browser3.wsEndpoint();

      assert.strictEqual(endpoint1, endpoint2, 'all should be same instance');
      assert.strictEqual(endpoint2, endpoint3, 'all should be same instance');
    });
  });

  void describe('saveResultToFile', () => {
    void it('saves content to file and returns path', async () => {
      const writeFileMock = mock.method(fs, 'writeFile', () =>
        Promise.resolve()
      );
      const mkdirMock = mock.method(fs, 'mkdir', () =>
        Promise.resolve(undefined)
      );

      try {
        const content = 'test content';
        const filePath = await saveResultToFile(content);

        assert.ok(
          filePath.includes(path.join('pptr-mcp', 'results')),
          'should be in results dir'
        );
        assert.ok(filePath.endsWith('.txt'), 'should have .txt extension');

        assert.strictEqual(mkdirMock.mock.callCount(), 1);
        assert.strictEqual(writeFileMock.mock.callCount(), 1);

        const [writeCall] = writeFileMock.mock.calls;

        assert.ok(writeCall, 'writeFile should have been called');

        const [writtenPath, writtenContent, writtenEncoding] =
          writeCall.arguments;

        assert.strictEqual(writtenPath, filePath);
        assert.strictEqual(writtenContent, content);
        assert.strictEqual(writtenEncoding, 'utf-8');
      } finally {
        writeFileMock.mock.restore();
        mkdirMock.mock.restore();
      }
    });

    void it('creates unique files for each call', async () => {
      const writeFileMock = mock.method(fs, 'writeFile', () =>
        Promise.resolve()
      );
      const mkdirMock = mock.method(fs, 'mkdir', () =>
        Promise.resolve(undefined)
      );

      try {
        const path1 = await saveResultToFile('content1');
        const path2 = await saveResultToFile('content2');

        assert.notStrictEqual(path1, path2, 'paths should be unique');
        assert.strictEqual(writeFileMock.mock.callCount(), 2);
      } finally {
        writeFileMock.mock.restore();
        mkdirMock.mock.restore();
      }
    });
  });

  void describe('isProfileLockError', () => {
    void it('detects "user data directory is already in use"', () => {
      const err = new Error(
        'Failed to launch: user data directory is already in use'
      );

      assert.strictEqual(isProfileLockError(err), true);
    });

    void it('detects "unable to move the cache"', () => {
      const err = new Error('Unable to move the cache');

      assert.strictEqual(isProfileLockError(err), true);
    });

    void it('detects "failed to create a ProcessSingleton"', () => {
      const err = new Error('Failed to create a ProcessSingleton');

      assert.strictEqual(isProfileLockError(err), true);
    });

    void it('returns false for unrelated errors', () => {
      const err = new Error('Connection refused');

      assert.strictEqual(isProfileLockError(err), false);
    });

    void it('handles string input', () => {
      assert.strictEqual(
        isProfileLockError('user data directory is already in use'),
        true
      );
    });
  });

  void describe('getLaunchErrorSuggestion', () => {
    void it('returns profile lock suggestion for lock errors', () => {
      const err = new Error('user data directory is already in use');
      const suggestion = getLaunchErrorSuggestion(err);

      assert.ok(suggestion.includes('Profile is locked'));
      assert.ok(suggestion.includes('persistent=false'));
    });

    void it('returns generic suggestion for other errors', () => {
      const err = new Error('Chrome not found');
      const suggestion = getLaunchErrorSuggestion(err);

      assert.ok(suggestion.includes('CHROME_PATH'));
    });
  });
});
