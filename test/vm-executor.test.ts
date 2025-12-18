import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import type { Browser } from 'puppeteer-core';

import { executeCode, safeSerialize } from '../src/vm-executor.js';
import { launchBrowser, MAX_RESULT_LENGTH } from '../src/browser-manager.js';

void describe('safeSerialize', () => {
  void it('converts circular objects to string representation', () => {
    const circular: Record<string, unknown> = { a: 1 };

    circular['self'] = circular;
    const result = safeSerialize(circular);

    assert.ok(typeof result === 'string', 'should return string');
    assert.ok(
      result.includes('[Circular'),
      'should indicate circular reference'
    );
  });

  void it('converts functions to string representation', () => {
    const fn = () => 42;
    const result = safeSerialize(fn);

    assert.strictEqual(typeof result, 'string');
    assert.ok(
      (result as string).includes('Function'),
      'should indicate function type'
    );
  });
});

void describe('executeCode', () => {
  let browser: Browser;

  beforeEach(async () => {
    browser = await launchBrowser();
  });

  afterEach(async () => {
    await browser.close();
  });

  void it('returns result for simple sync code', async () => {
    const response = await executeCode('return 42', browser, 5000);

    assert.strictEqual(response.success, true);
    assert.strictEqual((response as { result: unknown }).result, 42);
  });

  void it('handles async code with await', async () => {
    const code = `
      const page = await browser.newPage();
      const title = await page.title();
      return title;
    `;
    const response = await executeCode(code, browser, 10000);

    assert.strictEqual(response.success, true);
  });

  void it('captures console.log in logs array', async () => {
    const code = `
      console.log('hello', 'world');
      console.error('error message');
      console.warn('warning');
      console.info('info');
      return 'done';
    `;
    const response = await executeCode(code, browser, 5000);

    assert.strictEqual(response.success, true);
    assert.ok(response.logs.length >= 4, 'should capture all console calls');

    const logEntry = response.logs.find(
      (l) => l.level === 'log' && l.args.includes('hello')
    );

    assert.ok(logEntry, 'should have log entry');
  });

  void it('safely serializes console args with circular references', async () => {
    const code = `
      const obj = { a: 1 };
      obj.self = obj;
      console.log(obj);
      return 'done';
    `;
    const response = await executeCode(code, browser, 5000);

    assert.strictEqual(response.success, true);
    assert.ok(response.logs.length > 0, 'should have log entry');
  });

  void it('caps logs at limit (1001 logs -> 1000 + warning)', async () => {
    const code = `
      for (let i = 0; i < 1100; i++) {
        console.log('log', i);
      }
      return 'done';
    `;
    const response = await executeCode(code, browser, 10000);

    assert.strictEqual(response.success, true);
    assert.ok(response.logs.length <= 1001, 'should cap at 1001');

    const lastLog = response.logs[response.logs.length - 1];

    assert.ok(
      lastLog?.args.some(
        (a) => typeof a === 'string' && a.includes('truncated')
      ),
      'should have truncation warning'
    );
  });

  void it('provides setTimeout/clearTimeout', async () => {
    const code = `
      return new Promise(resolve => {
        const id = setTimeout(() => resolve('timeout fired'), 100);
      });
    `;
    const response = await executeCode(code, browser, 5000);

    assert.strictEqual(response.success, true);
    assert.strictEqual(
      (response as { result: unknown }).result,
      'timeout fired'
    );
  });

  void it('returns structured error for syntax errors', async () => {
    const code = 'return {{{';
    const response = await executeCode(code, browser, 5000);

    assert.strictEqual(response.success, false);
    const err = response as { details: { type: string }; error: string };

    assert.strictEqual(err.details.type, 'syntax');
    assert.ok(err.error.length > 0, 'should have error message');
  });

  void it('returns stack trace for runtime errors', async () => {
    const code = `
      const x = null;
      return x.foo.bar;
    `;
    const response = await executeCode(code, browser, 5000);

    assert.strictEqual(response.success, false);
    assert.strictEqual(
      (response as { details: { type: string } }).details.type,
      'runtime'
    );
  });

  void it('terminates sync infinite loop (vm timeout)', async () => {
    const code = 'while(true) {}';
    const response = await executeCode(code, browser, 5000);

    assert.strictEqual(response.success, false);
    assert.strictEqual(
      (response as { details: { type: string } }).details.type,
      'timeout'
    );
  });

  void it('terminates async hanging promise (Promise.race timeout)', async () => {
    const code = 'await new Promise(() => {})';
    const response = await executeCode(code, browser, 1000);

    assert.strictEqual(response.success, false);
    assert.strictEqual(
      (response as { details: { type: string } }).details.type,
      'timeout'
    );
  });

  void it('sandbox isolates Node.js globals', async () => {
    const globals = ['require', 'process', '__dirname', '__filename'];

    for (const global of globals) {
      const response = await executeCode(
        `return typeof ${global}`,
        browser,
        5000
      );

      assert.strictEqual(response.success, true);
      assert.strictEqual(
        (response as { result: unknown }).result,
        'undefined',
        `${global} should be undefined`
      );
    }
  });

  void it('handles non-serializable result without crash', async () => {
    const code = `
      return () => 42;
    `;
    const response = await executeCode(code, browser, 10000);

    assert.strictEqual(response.success, true);
    assert.ok(
      typeof (response as { result: unknown }).result === 'string',
      'non-serializable should become string'
    );
  });

  void it('normalizes non-Error throw to string', async () => {
    const code = 'throw "string error"';
    const response = await executeCode(code, browser, 5000);

    assert.strictEqual(response.success, false);
    assert.ok((response as { error: string }).error.includes('string error'));
  });

  void it('auto-closes created pages after success', async () => {
    const pagesBefore = (await browser.pages()).length;
    const code = `
      await browser.newPage();
      await browser.newPage();
      return 'done';
    `;
    const response = await executeCode(code, browser, 10000);

    assert.strictEqual(response.success, true);

    const pagesAfter = (await browser.pages()).length;

    assert.strictEqual(
      pagesAfter,
      pagesBefore,
      'created pages should be closed'
    );
  });

  void it('auto-closes created pages after error', async () => {
    const pagesBefore = (await browser.pages()).length;
    const code = `
      await browser.newPage();
      throw new Error('intentional error');
    `;
    const response = await executeCode(code, browser, 10000);

    assert.strictEqual(response.success, false);

    const pagesAfter = (await browser.pages()).length;

    assert.strictEqual(
      pagesAfter,
      pagesBefore,
      'created pages should be closed even on error'
    );
  });

  void it('saves large result to file', async () => {
    const writeFileMock = mock.method(fs, 'writeFile', () => Promise.resolve());
    const mkdirMock = mock.method(fs, 'mkdir', () =>
      Promise.resolve(undefined)
    );

    try {
      const largeSize = MAX_RESULT_LENGTH + 1000;
      const code = `return 'x'.repeat(${String(largeSize)})`;
      const response = await executeCode(code, browser, 10000);

      assert.strictEqual(response.success, true);

      const resultStr = (response as { result: unknown }).result as string;

      assert.ok(
        resultStr.includes('large result saved to file'),
        'result should indicate file save'
      );
      assert.ok(
        resultStr.includes('pptr-mcp/results/'),
        'result should contain path'
      );

      assert.strictEqual(mkdirMock.mock.callCount(), 1);
      assert.strictEqual(writeFileMock.mock.callCount(), 1);

      const [writeCall] = writeFileMock.mock.calls;
      const [writtenPath, writtenContent] = (writeCall?.arguments ?? []) as [
        string,
        string,
      ];

      assert.ok(writtenPath.includes('pptr-mcp/results/'));
      assert.ok(writtenPath.endsWith('.txt'));
      assert.ok(writtenContent.length > MAX_RESULT_LENGTH);
    } finally {
      writeFileMock.mock.restore();
      mkdirMock.mock.restore();
    }
  });
});
