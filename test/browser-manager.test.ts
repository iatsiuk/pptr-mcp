import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  getCustomChromePath,
  getProfilePath,
  launchBrowser,
  getPersistentBrowser,
  cleanupProfile,
  closePersistentBrowser,
  resetBrowserState,
  saveResultToFile,
  cleanupOldResults,
} from '../src/browser-manager.js';

void describe('browser-manager', () => {
  afterEach(async () => {
    await closePersistentBrowser();
    resetBrowserState();
  });

  void describe('getCustomChromePath', () => {
    void it('returns undefined when no env set (puppeteer uses bundled browser)', () => {
      const originalChrome = process.env['CHROME_PATH'];
      const originalPuppeteer = process.env['PUPPETEER_EXECUTABLE_PATH'];

      delete process.env['CHROME_PATH'];
      delete process.env['PUPPETEER_EXECUTABLE_PATH'];

      try {
        const chromePath = getCustomChromePath();

        assert.strictEqual(chromePath, undefined);
      } finally {
        if (originalChrome !== undefined) {
          process.env['CHROME_PATH'] = originalChrome;
        }
        if (originalPuppeteer !== undefined) {
          process.env['PUPPETEER_EXECUTABLE_PATH'] = originalPuppeteer;
        }
      }
    });

    void it('respects CHROME_PATH env variable', () => {
      const original = process.env['CHROME_PATH'];

      process.env['CHROME_PATH'] = '/custom/chrome/path';

      try {
        const chromePath = getCustomChromePath();

        assert.strictEqual(chromePath, '/custom/chrome/path');
      } finally {
        if (original === undefined) {
          delete process.env['CHROME_PATH'];
        } else {
          process.env['CHROME_PATH'] = original;
        }
      }
    });

    void it('respects PUPPETEER_EXECUTABLE_PATH env variable', () => {
      const originalChrome = process.env['CHROME_PATH'];
      const originalPuppeteer = process.env['PUPPETEER_EXECUTABLE_PATH'];

      delete process.env['CHROME_PATH'];
      process.env['PUPPETEER_EXECUTABLE_PATH'] = '/puppeteer/chrome/path';

      try {
        const chromePath = getCustomChromePath();

        assert.strictEqual(chromePath, '/puppeteer/chrome/path');
      } finally {
        if (originalChrome !== undefined) {
          process.env['CHROME_PATH'] = originalChrome;
        }
        if (originalPuppeteer === undefined) {
          delete process.env['PUPPETEER_EXECUTABLE_PATH'];
        } else {
          process.env['PUPPETEER_EXECUTABLE_PATH'] = originalPuppeteer;
        }
      }
    });
  });

  void describe('getProfilePath', () => {
    void it('returns fixed path in tmpdir for persistent=true', () => {
      const profilePath = getProfilePath(true);

      assert.ok(
        profilePath.includes('pptr-mcp/profiles/persistent'),
        'should contain profile identifier'
      );
      assert.ok(
        profilePath.startsWith(os.tmpdir()),
        'should be in temp directory'
      );
    });

    void it('returns unique uuid path for persistent=false', () => {
      const path1 = getProfilePath(false);
      const path2 = getProfilePath(false);

      assert.ok(
        path1.includes('pptr-mcp/profiles/'),
        'should be in profiles dir'
      );
      assert.notStrictEqual(path1, path2, 'should return unique paths');
    });

    void it('returns same path for multiple persistent=true calls', () => {
      const path1 = getProfilePath(true);
      const path2 = getProfilePath(true);

      assert.strictEqual(path1, path2, 'persistent paths should be identical');
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
      const customPath = path.join(os.tmpdir(), 'pptr-mcp-test-profile');
      const browser = await launchBrowser(customPath);

      try {
        assert.ok(browser.connected, 'browser should be connected');
      } finally {
        await browser.close();
        await cleanupProfile(customPath);
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
      const endpoint1 = browser1.wsEndpoint();

      await browser1.close();

      const browser2 = await getPersistentBrowser();

      assert.ok(browser2.connected, 'new browser should be connected');
      assert.notStrictEqual(
        browser2.wsEndpoint(),
        endpoint1,
        'should be new browser instance'
      );
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
          filePath.includes('pptr-mcp/results/'),
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

  void describe('cleanupOldResults', () => {
    void it('deletes files older than maxAge', async () => {
      const now = Date.now();
      const oldTime = now - 2 * 60 * 60 * 1000; // 2 hours ago
      const newTime = now - 30 * 60 * 1000; // 30 min ago

      const files = ['old-file.txt', 'new-file.txt'];
      const readdirMock = mock.method(fs, 'readdir', () =>
        Promise.resolve(files as unknown as fs.Dirent[])
      );
      const statMock = mock.method(fs, 'stat', (filePath: string) => {
        const isOld = filePath.includes('old-file');

        return Promise.resolve({
          mtimeMs: isOld ? oldTime : newTime,
        } as fs.Stats);
      });
      const unlinkMock = mock.method(fs, 'unlink', () => Promise.resolve());

      try {
        await cleanupOldResults(60 * 60 * 1000); // 1 hour maxAge

        assert.strictEqual(readdirMock.mock.callCount(), 1);
        assert.strictEqual(statMock.mock.callCount(), 2);
        assert.strictEqual(unlinkMock.mock.callCount(), 1);

        const [unlinkCall] = unlinkMock.mock.calls;

        assert.ok(
          (unlinkCall?.arguments[0] as string).includes('old-file'),
          'should delete old file'
        );
      } finally {
        readdirMock.mock.restore();
        statMock.mock.restore();
        unlinkMock.mock.restore();
      }
    });

    void it('handles missing results directory gracefully', async () => {
      const readdirMock = mock.method(fs, 'readdir', () =>
        Promise.reject(new Error('ENOENT'))
      );

      try {
        // should not throw
        await cleanupOldResults();
        assert.ok(true, 'should handle missing directory');
      } finally {
        readdirMock.mock.restore();
      }
    });
  });
});
