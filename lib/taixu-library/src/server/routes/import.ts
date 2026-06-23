/**
 * import — 导入路由
 *
 * 支持单个文件解析和整个文件夹导入。
 */

import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProcessingPipeline } from '../../folder-manager/SyncManager.js';
import { ValidationError } from '../middleware/errorHandler.js';

export function createImportRoutes(pipeline: ProcessingPipeline) {
  return {
    async parseFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const filePath = url.searchParams.get('path');

      if (!filePath) throw new ValidationError('path parameter is required');

      try {
        await stat(filePath);
      } catch {
        throw new ValidationError(`File not found: ${filePath}`);
      }

      try {
        await pipeline.processFile(filePath);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, data: { filePath, status: 'processed' } }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: false,
          error: { code: 'PROCESSING_ERROR', message: String(err) },
        }));
      }
    },

    async importFolder(_req: IncomingMessage, res: ServerResponse): Promise<void> {
      const report = await pipeline.syncAll();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: report }));
    },
  };
}
