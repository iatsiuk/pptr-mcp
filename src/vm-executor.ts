import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import vm from 'node:vm';
import type { Browser } from 'puppeteer-core';

const RESULTS_DIR = path.join(os.tmpdir(), 'pptr-mcp', 'results');

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

export interface ExecutionResult {
  success: true;
  result: unknown;
  logs: LogEntry[];
}

export type ExecutionResponse = ExecutionResult | ExecutionError;

export async function saveResultToFile(content: string): Promise<string> {
  await fs.mkdir(RESULTS_DIR, { recursive: true });
  const filePath = path.join(RESULTS_DIR, `${crypto.randomUUID()}.txt`);

  await fs.writeFile(filePath, content, 'utf-8');

  return filePath;
}

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
  const pushLog = (level: LogEntry['level'], ...args: unknown[]) => {
    if (logs.length < MAX_LOGS) {
      logs.push({ level, args: args.map(safeSerialize) });
    } else if (logs.length === MAX_LOGS) {
      logs.push({ level: 'warn', args: ['[truncated: log limit reached]'] });
    }
  };

  return Object.fromEntries(
    (['log', 'error', 'warn', 'info'] as const).map((level) => [
      level,
      (...args: unknown[]) => {
        pushLog(level, ...args);
      },
    ])
  ) as VmConsole;
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
    Buffer,
  });
}

function isErrorLike(
  e: unknown
): e is { message: string; code?: string; name?: string; stack?: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as Error).message === 'string'
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

  const cleanup = () => {
    for (const id of timers) {
      clearTimeout(id);
    }
    timers.clear();
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
    cleanup();
  }
}
