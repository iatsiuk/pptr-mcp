import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Launcher } from 'chrome-launcher';
import puppeteer, { type Browser } from 'puppeteer-core';

const BASE_DIR = path.join(os.tmpdir(), 'pptr-mcp');
const PROFILES_DIR = path.join(BASE_DIR, 'profiles');
const RESULTS_DIR = path.join(BASE_DIR, 'results');

export const MAX_RESULT_LENGTH = 100_000;

export type ErrorType =
  | 'syntax'
  | 'runtime'
  | 'timeout'
  | 'launch'
  | 'serialization';

export interface LogEntry {
  level: 'log' | 'error' | 'warn' | 'info';
  args: unknown[];
}

export interface ExecutionError {
  success: false;
  error: string;
  details: {
    type: ErrorType;
    stack?: string;
    line?: number;
    column?: number;
    suggestion?: string;
  };
  logs: LogEntry[];
}

export function findChromePath(): string {
  const envPath =
    process.env['CHROME_PATH'] ?? process.env['PUPPETEER_EXECUTABLE_PATH'];

  if (envPath) {
    return envPath;
  }

  const chromePath = Launcher.getFirstInstallation();

  if (!chromePath) {
    throw new Error('Chrome not found. Set CHROME_PATH or install Chrome.');
  }
  return chromePath;
}

const persistentProfilePath = path.join(PROFILES_DIR, 'persistent');

export function getProfilePath(persistent: boolean): string {
  if (persistent) {
    return persistentProfilePath;
  }
  return path.join(PROFILES_DIR, crypto.randomUUID());
}

export async function saveResultToFile(content: string): Promise<string> {
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const filePath = path.join(RESULTS_DIR, `${crypto.randomUUID()}.txt`);

  await fs.writeFile(filePath, content, 'utf-8');

  return filePath;
}

const DEFAULT_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
];

let customArgs: string[] = [];

export function setLaunchArgs(args: string[]): void {
  customArgs = args;
}

export async function launchBrowser(profilePath?: string): Promise<Browser> {
  const executablePath = findChromePath();

  const options: Parameters<typeof puppeteer.launch>[0] = {
    executablePath,
    headless: true,
    args: [...DEFAULT_ARGS, ...customArgs],
  };

  if (profilePath) {
    options.userDataDir = profilePath;
  }

  return puppeteer.launch(options);
}

let persistentBrowser: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;
let executionLock: Promise<void> = Promise.resolve();

export async function withPersistentLock<T>(fn: () => Promise<T>): Promise<T> {
  const previousLock = executionLock;

  let release: () => void = () => {
    // will be replaced by Promise resolve
  };

  executionLock = new Promise((resolve) => {
    release = resolve;
  });

  await previousLock;

  try {
    return await fn();
  } finally {
    release();
  }
}

export async function getPersistentBrowser(): Promise<Browser> {
  if (persistentBrowser?.connected) {
    return persistentBrowser;
  }

  if (launchPromise) {
    return launchPromise;
  }

  launchPromise = launchBrowser(persistentProfilePath);
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

export async function cleanupProfile(profilePath: string): Promise<void> {
  try {
    await fs.rm(profilePath, { recursive: true, force: true });
  } catch {
    // ignore - tmp will be cleaned by OS eventually
  }
}

export function createErrorResponse(
  type: ErrorType,
  error: string,
  suggestion?: string
): ExecutionError {
  const details: ExecutionError['details'] = { type };

  if (suggestion) {
    details.suggestion = suggestion;
  }

  return {
    success: false,
    error,
    details,
    logs: [],
  };
}
