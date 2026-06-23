/**
 * errorHandler — 统一错误处理中间件
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export interface AppError {
  statusCode: number;
  code: string;
  message: string;
}

export class NotFoundError extends Error implements AppError {
  statusCode = 404;
  code = 'NOT_FOUND';
  constructor(msg: string = 'Resource not found') {
    super(msg);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error implements AppError {
  statusCode = 400;
  code = 'VALIDATION_ERROR';
  constructor(msg: string) {
    super(msg);
    this.name = 'ValidationError';
  }
}

export function errorHandler(
  err: Error,
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  const appErr = err as unknown as AppError;
  const statusCode = appErr.statusCode || 500;
  const code = appErr.code || 'INTERNAL_ERROR';
  const message = appErr.message || 'Internal server error';

  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    success: false,
    error: { code, message },
  }));
}
