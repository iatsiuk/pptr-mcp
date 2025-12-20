import { parseArgs as nodeParseArgs } from 'node:util';

export interface CliOptions {
  headless: boolean;
  viewport?: { width: number; height: number };
  chromeArgs: string[];
  help?: boolean;
  viewportRaw?: string; // for validation warning
}

const KNOWN_OPTIONS = ['no-headless', 'viewport', 'help', 'h'];

export function parseArgs(args: string[]): CliOptions {
  const { values, tokens } = nodeParseArgs({
    args,
    options: {
      'no-headless': { type: 'boolean', default: false },
      viewport: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  // collect unknown options and positionals after '--' as chromeArgs
  const chromeArgs: string[] = [];
  let afterTerminator = false;

  for (const token of tokens) {
    if (token.kind === 'option-terminator') {
      afterTerminator = true;
    } else if (afterTerminator && token.kind === 'positional') {
      chromeArgs.push(token.value);
    } else if (token.kind === 'option' && !KNOWN_OPTIONS.includes(token.name)) {
      // unknown option - pass to chrome
      chromeArgs.push(
        token.value !== undefined
          ? `--${token.name}=${token.value}`
          : `--${token.name}`
      );
    }
  }

  const options: CliOptions = {
    headless: !values['no-headless'],
    chromeArgs,
  };

  if (values.help) {
    options.help = true;
  }

  if (typeof values.viewport === 'string') {
    options.viewportRaw = values.viewport;
    const viewport = parseViewport(values.viewport);

    if (viewport) {
      options.viewport = viewport;
    }
  }

  return options;
}

function parseViewport(
  value: string
): { width: number; height: number } | undefined {
  const parts = value.split('x');

  if (parts.length !== 2) return undefined;

  const [w, h] = parts.map(Number);

  if (!w || !h || w <= 0 || h <= 0) return undefined;

  return { width: w, height: h };
}

export const HELP_TEXT = `Usage: pptr-mcp [options] [-- chrome-args...]

Options:
  --no-headless        Run with visible browser window
  --viewport=WxH       Set viewport size (e.g., --viewport=1920x1080)
  --help, -h           Show this help

Examples:
  pptr-mcp --no-headless
  pptr-mcp --viewport=1280x720
  pptr-mcp -- --disable-web-security
`;
