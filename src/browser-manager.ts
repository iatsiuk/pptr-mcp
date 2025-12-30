import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { ensureBrowserInstalled } from './browser-installer.ts';
import {
  type ErrorType,
  type ExecutionResponseWithScreenshots,
} from './vm-executor.ts';

const DEFAULT_PROFILE_DIR = path.join(
  os.homedir(),
  '.cache',
  'pptr-mcp',
  'profile'
);
let profileDir = DEFAULT_PROFILE_DIR;

export function setProfileDir(dir: string): void {
  profileDir = dir;
}

export function getCustomChromePath(): string | undefined {
  return process.env['CHROME_PATH'] ?? process.env['PUPPETEER_EXECUTABLE_PATH'];
}

export async function getProfileDir(): Promise<string> {
  await fs.mkdir(profileDir, { recursive: true });
  return profileDir;
}

const DEFAULT_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  '--hide-crash-restore-bubble',
];

const HEADLESS_ARGS = ['--screen-info={3840x2160}'];

export interface BrowserConfig {
  headless: boolean;
  viewport?: { width: number; height: number };
  chromeArgs: string[];
}

let config: BrowserConfig = {
  headless: true,
  chromeArgs: [],
};

export function setBrowserConfig(newConfig: Partial<BrowserConfig>): void {
  config = { headless: true, chromeArgs: [], ...newConfig };
}

// extract --user-data-dir from chromeArgs if present
function extractUserDataDir(chromeArgs: string[]): {
  userDataDir: string | undefined;
  filteredArgs: string[];
} {
  let userDataDir: string | undefined;
  const filteredArgs: string[] = [];

  for (const arg of chromeArgs) {
    if (arg.startsWith('--user-data-dir=')) {
      userDataDir = arg.slice('--user-data-dir='.length);
    } else {
      filteredArgs.push(arg);
    }
  }

  return { userDataDir, filteredArgs };
}

export async function launchBrowser(profilePath?: string): Promise<Browser> {
  const executablePath =
    getCustomChromePath() ?? (await ensureBrowserInstalled());

  const { userDataDir: customDataDir, filteredArgs } = extractUserDataDir(
    config.chromeArgs
  );
  const effectiveProfilePath = customDataDir ?? profilePath;

  const args = [...DEFAULT_ARGS, ...filteredArgs];

  if (config.headless) {
    args.push(...HEADLESS_ARGS);
  }

  if (!config.headless && config.viewport) {
    args.push(
      `--window-size=${String(config.viewport.width)},${String(config.viewport.height)}`
    );
  }

  return puppeteer.launch({
    headless: config.headless,
    args,
    executablePath,
    defaultViewport: config.viewport ?? null,
    pipe: true,
    ...(effectiveProfilePath && { userDataDir: effectiveProfilePath }),
  });
}

let persistentBrowser: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;
let executionLock: Promise<void> = Promise.resolve();

export async function waitForPersistentIdle(): Promise<void> {
  await executionLock;
}

export async function withPersistentLock<T>(fn: () => Promise<T>): Promise<T> {
  const previousLock = executionLock;
  let resolve!: (value: undefined) => void;
  const promise = new Promise<undefined>((res) => {
    resolve = res;
  });

  executionLock = promise;
  await previousLock;

  try {
    return await fn();
  } finally {
    resolve(undefined);
  }
}

export async function getPersistentBrowser(): Promise<Browser> {
  if (persistentBrowser?.connected) {
    return persistentBrowser;
  }

  if (launchPromise) {
    return launchPromise;
  }

  launchPromise = (async () => {
    const profileDir = await getProfileDir();

    return launchBrowser(profileDir);
  })();

  try {
    persistentBrowser = await launchPromise;
    persistentBrowser.on('disconnected', () => {
      persistentBrowser = null;
    });
    return persistentBrowser;
  } finally {
    launchPromise = null;
  }
}

export async function closePersistentBrowser(): Promise<void> {
  if (launchPromise) {
    await launchPromise.catch(() => {});
  }

  if (persistentBrowser) {
    await persistentBrowser.close().catch(() => {});
    persistentBrowser = null;
  }
  launchPromise = null;
}

export function resetBrowserState(): void {
  persistentBrowser = null;
  launchPromise = null;
  executionLock = Promise.resolve();
  config = { headless: true, chromeArgs: [] };
  profileDir = DEFAULT_PROFILE_DIR;
}

export function isProfileLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes('user data directory is already in use') ||
    lowerMessage.includes('unable to move the cache') ||
    lowerMessage.includes('failed to create a processsingleton') ||
    (lowerMessage.includes('lock') && lowerMessage.includes('profile'))
  );
}

export function getLaunchErrorSuggestion(error: unknown): string {
  if (isProfileLockError(error)) {
    return `Profile is locked by another process. Close other pptr-mcp instances or use persistent=false for isolated sessions. Profile location: ${profileDir}`;
  }

  return 'Check Chrome installation or set CHROME_PATH';
}

export function createErrorResponse(
  type: ErrorType,
  error: string,
  suggestion?: string
): ExecutionResponseWithScreenshots {
  return {
    success: false as const,
    error,
    details: { type, ...(suggestion && { suggestion }) },
    logs: [],
    screenshots: [],
  };
}
