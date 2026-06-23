/**
 * logger — 日志工具
 *
 * 格式与主程序一致: [timestamp] [LEVEL] [Library] message
 */

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_COLORS: Record<LogLevel, string> = {
  DEBUG: '\x1b[90m',
  INFO: '\x1b[32m',
  WARN: '\x1b[33m',
  ERROR: '\x1b[31m',
};

const RESET = '\x1b[0m';

function log(level: LogLevel, ...args: any[]): void {
  const timestamp = new Date().toISOString();
  const color = LEVEL_COLORS[level];
  const prefix = `${color}[${timestamp}] [${level}] [Library]${RESET}`;
  const method = level === 'ERROR' ? console.error :
    level === 'WARN' ? console.warn :
    level === 'DEBUG' ? console.debug :
    console.log;
  method(prefix, ...args);
}

export const logger = {
  debug: (...args: any[]) => log('DEBUG', ...args),
  info: (...args: any[]) => log('INFO', ...args),
  warn: (...args: any[]) => log('WARN', ...args),
  error: (...args: any[]) => log('ERROR', ...args),
};
