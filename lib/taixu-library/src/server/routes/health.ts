/**
 * health — 健康检查路由
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export function handleHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  stats: { entries: number; raw: number; schema: number },
): void {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    success: true,
    data: {
      status: 'ok',
      version: '1.0.0',
      uptime: process.uptime(),
      stats,
    },
  }));
}
