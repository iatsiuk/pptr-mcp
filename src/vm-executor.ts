import vm from 'node:vm';
import { inspect } from 'node:util';
import type { Browser, BrowserContext, Page } from 'puppeteer';
import {
  type LogEntry,
  type ErrorType,
  type ExecutionError,
  MAX_RESULT_LENGTH,
  saveResultToFile,
} from './browser-manager.js';

export type { LogEntry };

export interface ExecutionResult {
  success: true;
  result: unknown;
  logs: LogEntry[];
}

export type ExecutionResponse = ExecutionResult | ExecutionError;

const MAX_LOGS = 1000;
const SYNC_TIMEOUT = 5000;
const INSPECT_OPTIONS = { depth: 2, maxArrayLength: 100 };

export function safeSerialize(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);

    // JSON.stringify returns undefined for functions, symbols, etc.
    if (typeof serialized !== 'string') {
      return inspect(value, INSPECT_OPTIONS);
    }

    return value;
  } catch {
    return inspect(value, INSPECT_OPTIONS);
  }
}

type VmConsole = Pick<Console, 'log' | 'error' | 'warn' | 'info'>;

function createConsole(logs: LogEntry[]): VmConsole {
  const pushLog = (level: LogEntry['level'], args: unknown[]) => {
    if (logs.length < MAX_LOGS) {
      logs.push({ level, args: args.map(safeSerialize) });
    } else if (logs.length === MAX_LOGS) {
      logs.push({ level: 'warn', args: ['[truncated: log limit reached]'] });
    }
  };

  return {
    log: (...args: unknown[]) => {
      pushLog('log', args);
    },
    error: (...args: unknown[]) => {
      pushLog('error', args);
    },
    warn: (...args: unknown[]) => {
      pushLog('warn', args);
    },
    info: (...args: unknown[]) => {
      pushLog('info', args);
    },
  };
}

export function wrapUserCode(code: string): string {
  return `(async () => {\n${code}\n})()`;
}

function createTrackedTimers(timers: Set<NodeJS.Timeout>) {
  const trackedSetTimeout = (
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ): NodeJS.Timeout => {
    const id = setTimeout(callback, ms, ...args);

    timers.add(id);

    return id;
  };

  const trackedClearTimeout = (id?: NodeJS.Timeout): void => {
    if (id) {
      timers.delete(id);
      clearTimeout(id);
    }
  };

  return { setTimeout: trackedSetTimeout, clearTimeout: trackedClearTimeout };
}

function createContext(
  browser: Browser,
  logs: LogEntry[],
  timers: Set<NodeJS.Timeout>
): vm.Context {
  const { setTimeout, clearTimeout } = createTrackedTimers(timers);

  return vm.createContext({
    browser,
    console: createConsole(logs),
    setTimeout,
    clearTimeout,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Date,
    RegExp,
    Error,
    Map,
    Set,
    Promise,
    URL,
    URLSearchParams,
  });
}

function isErrorLike(
  e: unknown
): e is { message: string; code?: string; name?: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  );
}

function classifyError(error: unknown): ErrorType {
  if (error instanceof SyntaxError) {
    return 'syntax';
  }
  if (isErrorLike(error)) {
    if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      return 'timeout';
    }
    if (error.name === 'SyntaxError') {
      return 'syntax';
    }
    const msg = error.message.toLowerCase();

    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'timeout';
    }
  }
  return 'runtime';
}

function formatError(error: unknown): { message: string; stack?: string } {
  if (isErrorLike(error)) {
    const result: { message: string; stack?: string } = {
      message: error.message,
    };

    if ('stack' in error && typeof error.stack === 'string') {
      result.stack = error.stack;
    }

    return result;
  }

  return { message: String(error) };
}

async function executeWithTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Execution timeout'));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export async function executeCode(
  code: string,
  browser: Browser,
  timeout: number
): Promise<ExecutionResponse> {
  const logs: LogEntry[] = [];
  const timers = new Set<NodeJS.Timeout>();

  const pagesBefore = new Set<Page>(await browser.pages());
  const contextsBefore = new Set<BrowserContext>(browser.browserContexts());

  const cleanup = async () => {
    for (const id of timers) {
      clearTimeout(id);
    }
    timers.clear();

    const pagesAfter = await browser.pages();

    for (const page of pagesAfter) {
      if (!pagesBefore.has(page)) {
        await page.close().catch(() => {
          // ignore close errors
        });
      }
    }

    const contextsAfter = browser.browserContexts();

    for (const ctx of contextsAfter) {
      if (!contextsBefore.has(ctx)) {
        await ctx.close().catch(() => {
          // ignore close errors
        });
      }
    }
  };

  try {
    const context = createContext(browser, logs, timers);
    const wrapped = wrapUserCode(code);

    let script: vm.Script;

    try {
      script = new vm.Script(wrapped);
    } catch (error) {
      const { message, stack } = formatError(error);
      const details: ExecutionError['details'] = { type: 'syntax' };

      if (stack) {
        details.stack = stack;
      }

      return {
        success: false,
        error: message,
        details,
        logs,
      };
    }

    const resultPromise = script.runInContext(context, {
      timeout: SYNC_TIMEOUT,
    }) as Promise<unknown>;
    const result = await executeWithTimeout(resultPromise, timeout);
    const serialized = safeSerialize(result);
    const serializedStr = JSON.stringify(serialized);

    if (serializedStr.length > MAX_RESULT_LENGTH) {
      const filePath = await saveResultToFile(serializedStr);

      return {
        success: true,
        result: `[large result saved to file: ${filePath}]`,
        logs,
      };
    }

    return {
      success: true,
      result: serialized,
      logs,
    };
  } catch (error) {
    const type = classifyError(error);

    // early cleanup on timeout to terminate pending Puppeteer operations
    if (type === 'timeout') {
      await cleanup();
    }

    const { message, stack } = formatError(error);
    const details: ExecutionError['details'] = { type };

    if (stack) {
      details.stack = stack;
    }

    return {
      success: false,
      error: message,
      details,
      logs,
    };
  } finally {
    await cleanup();
  }
}
