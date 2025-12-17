import type { LoggingLevel } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface Logger {
  debug: (logger: string, data: unknown) => void;
  info: (logger: string, data: unknown) => void;
  warning: (logger: string, data: unknown) => void;
  error: (logger: string, data: unknown) => void;
}

export function createLogger(server: McpServer): Logger {
  const send = (level: LoggingLevel, logger: string, data: unknown) => {
    void server.server.sendLoggingMessage({ level, logger, data });
  };

  return {
    debug: (logger: string, data: unknown) => {
      send('debug', logger, data);
    },
    info: (logger: string, data: unknown) => {
      send('info', logger, data);
    },
    warning: (logger: string, data: unknown) => {
      send('warning', logger, data);
    },
    error: (logger: string, data: unknown) => {
      send('error', logger, data);
    },
  };
}
