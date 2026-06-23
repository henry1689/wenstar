/**
 * logger — HTTP 请求日志中间件
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger as appLogger } from '../../utils/logger.js';

export function requestLogger(
  req: IncomingMessage,
  res: ServerResponse,
  startTime: [number, number] = process.hrtime(),
): void {
  const originalEnd = res.end.bind(res);
  res.end = function (this: ServerResponse, ...args: any[]): any {
    const [sec, nanosec] = process.hrtime(startTime);
    const ms = (sec * 1000 + nanosec / 1e6).toFixed(2);
    const statusCode = res.statusCode;
    const method = req.method || 'GET';
    const url = req.url || '/';

    const level = statusCode >= 400 ? 'warn' : 'info';
    appLogger[level](`${method} ${url} → ${statusCode} (${ms}ms)`);

    return originalEnd(...args);
  } as any;
}
