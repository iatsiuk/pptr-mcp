import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { ensureBrowserInstalled } from './browser-installer.js';
import { type ErrorType, type ExecutionError } from './vm-executor.js';

const PROFILE_DIR = path.join(os.homedir(), '.cache', 'pptr-mcp', 'profile');

export function getCustomChromePath(): string | undefined {
  return process.env['CHROME_PATH'] ?? process.env['PUPPETEER_EXECUTABLE_PATH'];
}

export async function getProfileDir(): Promise<string> {
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  return PROFILE_DIR;
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

export async function launchBrowser(profilePath?: string): Promise<Browser> {
  const executablePath =
    getCustomChromePath() ?? (await ensureBrowserInstalled());

  const args = [...DEFAULT_ARGS, ...config.chromeArgs];

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
    ...(profilePath && { userDataDir: profilePath }),
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
  const { promise, resolve } = Promise.withResolvers<undefined>();

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

  // wrap in async IIFE to capture promise synchronously before any await
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
    try {
      await launchPromise;
    } catch {
      // ignore launch errors during close
    }
  }

  if (persistentBrowser) {
    await persistentBrowser.close().catch(() => {
      // ignore
    });
    persistentBrowser = null;
  }
  launchPromise = null;
}

export function resetBrowserState(): void {
  persistentBrowser = null;
  launchPromise = null;
  executionLock = Promise.resolve();
  config = { headless: true, chromeArgs: [] };
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
    return `Profile is locked by another process. Close other pptr-mcp instances or use persistent=false for isolated sessions. Profile location: ${PROFILE_DIR}`;
  }

  return 'Check Chrome installation or set CHROME_PATH';
}

export function createErrorResponse(
  type: ErrorType,
  error: string,
  suggestion?: string
): ExecutionError {
  return {
    success: false,
    error,
    details: { type, ...(suggestion && { suggestion }) },
    logs: [],
  };
}
