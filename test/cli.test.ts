import { describe, it } from 'node:test';
import assert from 'node:assert';

import { parseArgs, HELP_TEXT } from '../src/cli-args.js';

void describe('parseArgs', () => {
  void it('returns defaults when no args', () => {
    const options = parseArgs([]);

    assert.strictEqual(options.headless, true);
    assert.strictEqual(options.viewport, undefined);
    assert.strictEqual(options.help, undefined);
    assert.deepStrictEqual(options.chromeArgs, []);
  });

  void it('parses --no-headless', () => {
    const options = parseArgs(['--no-headless']);

    assert.strictEqual(options.headless, false);
  });

  void it('parses valid --viewport=WxH', () => {
    const options = parseArgs(['--viewport=1920x1080']);

    assert.deepStrictEqual(options.viewport, { width: 1920, height: 1080 });
    assert.strictEqual(options.viewportRaw, '1920x1080');
  });

  void it('stores raw value for invalid viewport formats', () => {
    const invalidFormats = ['1920', 'widexhigh', '0x0', '-100x-200'];

    for (const format of invalidFormats) {
      const options = parseArgs([`--viewport=${format}`]);

      assert.strictEqual(options.viewport, undefined, `--viewport=${format}`);
      assert.strictEqual(
        options.viewportRaw,
        format,
        `viewportRaw for ${format}`
      );
    }
  });

  void it('collects chrome args after --', () => {
    const options = parseArgs([
      '--no-headless',
      '--',
      '--disable-web-security',
      '--ignore-certificate-errors',
    ]);

    assert.strictEqual(options.headless, false);
    assert.deepStrictEqual(options.chromeArgs, [
      '--disable-web-security',
      '--ignore-certificate-errors',
    ]);
  });

  void it('treats unknown args as chrome args', () => {
    const options = parseArgs(['--some-unknown-flag', '--another-flag=value']);

    assert.deepStrictEqual(options.chromeArgs, [
      '--some-unknown-flag',
      '--another-flag=value',
    ]);
  });

  void it('combines multiple options', () => {
    const options = parseArgs([
      '--no-headless',
      '--viewport=1920x1080',
      '--',
      '--disable-gpu',
    ]);

    assert.strictEqual(options.headless, false);
    assert.deepStrictEqual(options.viewport, { width: 1920, height: 1080 });
    assert.deepStrictEqual(options.chromeArgs, ['--disable-gpu']);
  });

  void it('treats known options after -- as chrome args', () => {
    const options = parseArgs(['--', '--no-headless', '--viewport=800x600']);

    assert.strictEqual(
      options.headless,
      true,
      'headless should remain default'
    );
    assert.strictEqual(
      options.viewport,
      undefined,
      'viewport should not be parsed'
    );
    assert.deepStrictEqual(options.chromeArgs, [
      '--no-headless',
      '--viewport=800x600',
    ]);
  });

  void describe('--help', () => {
    void it('sets help flag on --help', () => {
      const options = parseArgs(['--help']);

      assert.strictEqual(options.help, true);
    });

    void it('sets help flag on -h', () => {
      const options = parseArgs(['-h']);

      assert.strictEqual(options.help, true);
    });
  });

  void describe('HELP_TEXT', () => {
    void it('contains usage info', () => {
      assert.ok(HELP_TEXT.includes('Usage:'));
      assert.ok(HELP_TEXT.includes('--no-headless'));
      assert.ok(HELP_TEXT.includes('--viewport'));
      assert.ok(HELP_TEXT.includes('--help'));
    });
  });

  void describe('viewport aliases', () => {
    void it('parses 4k aliases', () => {
      const aliases = ['4k', '2160p', 'uhd'];
      const expected = { width: 3840, height: 2160 };

      for (const alias of aliases) {
        const options = parseArgs([`--viewport=${alias}`]);

        assert.deepStrictEqual(
          options.viewport,
          expected,
          `--viewport=${alias}`
        );
      }
    });

    void it('parses 1440p aliases', () => {
      const aliases = ['1440p', 'qhd', '2k'];
      const expected = { width: 2560, height: 1440 };

      for (const alias of aliases) {
        const options = parseArgs([`--viewport=${alias}`]);

        assert.deepStrictEqual(
          options.viewport,
          expected,
          `--viewport=${alias}`
        );
      }
    });

    void it('parses 1080p aliases', () => {
      const aliases = ['1080p', 'fhd'];
      const expected = { width: 1920, height: 1080 };

      for (const alias of aliases) {
        const options = parseArgs([`--viewport=${alias}`]);

        assert.deepStrictEqual(
          options.viewport,
          expected,
          `--viewport=${alias}`
        );
      }
    });

    void it('parses 720p aliases', () => {
      const aliases = ['720p', 'hd'];
      const expected = { width: 1280, height: 720 };

      for (const alias of aliases) {
        const options = parseArgs([`--viewport=${alias}`]);

        assert.deepStrictEqual(
          options.viewport,
          expected,
          `--viewport=${alias}`
        );
      }
    });

    void it('parses 480p', () => {
      const options = parseArgs(['--viewport=480p']);

      assert.deepStrictEqual(options.viewport, { width: 854, height: 480 });
    });

    void it('is case-insensitive', () => {
      const cases = ['4K', 'FHD', 'HD', 'QHD', 'UHD'];

      for (const alias of cases) {
        const options = parseArgs([`--viewport=${alias}`]);

        assert.ok(options.viewport, `--viewport=${alias} should be parsed`);
      }
    });

    void it('treats unknown aliases as invalid', () => {
      const options = parseArgs(['--viewport=8k']);

      assert.strictEqual(options.viewport, undefined);
      assert.strictEqual(options.viewportRaw, '8k');
    });
  });
});
