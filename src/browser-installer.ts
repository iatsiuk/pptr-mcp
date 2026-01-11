import {
  Browser,
  detectBrowserPlatform,
  getInstalledBrowsers,
  install,
  resolveBuildId,
  computeExecutablePath,
} from '@puppeteer/browsers';
import os from 'node:os';
import path from 'node:path';

const CACHE_DIR =
  process.env['PUPPETEER_CACHE_DIR'] ??
  path.join(os.homedir(), '.cache', 'puppeteer');

let installPromise: Promise<string> | null = null;
let cachedExecutablePath: string | null = null;

export interface InstallStatus {
  installing: boolean;
  progress: number; // 0-100
}

let installStatus: InstallStatus = { installing: false, progress: 0 };

export function getInstallStatus(): InstallStatus {
  return { ...installStatus };
}

export function getCacheDir(): string {
  return CACHE_DIR;
}

export function ensureBrowserInstalled(): Promise<string> {
  if (cachedExecutablePath) {
    return Promise.resolve(cachedExecutablePath);
  }

  installPromise ??= doEnsureBrowser().catch((err: unknown) => {
    installPromise = null;
    throw err;
  });

  return installPromise;
}

async function doEnsureBrowser(): Promise<string> {
  const platform = detectBrowserPlatform();

  if (!platform) {
    throw new Error('Unsupported platform');
  }

  const installed = await getInstalledBrowsers({ cacheDir: CACHE_DIR });
  const chrome = installed.find((b) => b.browser === Browser.CHROME);

  if (chrome) {
    cachedExecutablePath = computeExecutablePath({
      browser: Browser.CHROME,
      buildId: chrome.buildId,
      cacheDir: CACHE_DIR,
    });

    return cachedExecutablePath;
  }

  const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');

  installStatus = { installing: true, progress: 0 };

  try {
    await install({
      browser: Browser.CHROME,
      buildId,
      cacheDir: CACHE_DIR,
      downloadProgressCallback: (downloadedBytes, totalBytes) => {
        const progress = Math.round((downloadedBytes / totalBytes) * 100);

        installStatus = { installing: true, progress };
      },
    });
    installStatus = { installing: false, progress: 100 };
  } catch (err) {
    installStatus = { installing: false, progress: 0 };
    throw err;
  }

  cachedExecutablePath = computeExecutablePath({
    browser: Browser.CHROME,
    buildId,
    cacheDir: CACHE_DIR,
  });

  return cachedExecutablePath;
}

export function resetInstallerState(): void {
  installPromise = null;
  cachedExecutablePath = null;
  installStatus = { installing: false, progress: 0 };
}
