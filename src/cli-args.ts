import { parseArgs as nodeParseArgs } from 'node:util';

const VIEWPORT_ALIASES: Record<string, { width: number; height: number }> = {
  '4k': { width: 3840, height: 2160 },
  '2160p': { width: 3840, height: 2160 },
  uhd: { width: 3840, height: 2160 },
  '1440p': { width: 2560, height: 1440 },
  qhd: { width: 2560, height: 1440 },
  '2k': { width: 2560, height: 1440 },
  '1080p': { width: 1920, height: 1080 },
  fhd: { width: 1920, height: 1080 },
  '720p': { width: 1280, height: 720 },
  hd: { width: 1280, height: 720 },
  '480p': { width: 854, height: 480 },
};

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
  const alias = VIEWPORT_ALIASES[value.toLowerCase()];

  if (alias) return alias;

  const parts = value.split('x');

  if (parts.length !== 2) return undefined;

  const [w, h] = parts.map(Number);

  if (!w || !h || w <= 0 || h <= 0) return undefined;

  return { width: w, height: h };
}

export const HELP_TEXT = `Usage: pptr-mcp [options] [-- chrome-args...]

Options:
  --no-headless        Run with visible browser window
  --viewport=VALUE     Set viewport size (e.g., 1920x1080 or 1080p)
  --help, -h           Show this help

Examples:
  pptr-mcp --no-headless
  pptr-mcp --viewport=1280x720
  pptr-mcp --viewport=1080p
  pptr-mcp -- --disable-web-security
`;
