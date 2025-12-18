import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface Logger {
  debug: (logger: string, data: unknown) => void;
  info: (logger: string, data: unknown) => void;
  warning: (logger: string, data: unknown) => void;
  error: (logger: string, data: unknown) => void;
}

export function createLogger(server: McpServer): Logger {
  const mk = (level: LoggingLevel) => (logger: string, data: unknown) =>
    void server.server.sendLoggingMessage({ level, logger, data });

  return {
    debug: mk('debug'),
    info: mk('info'),
    warning: mk('warning'),
    error: mk('error'),
  };
}
