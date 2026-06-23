/**
 * HttpServer — HTTP REST 服务（端口 3737）
 *
 * 提供词条 CRUD、同步、导入等完整 REST API。
 * 使用 Node.js 内置 http 模块，无外部框架依赖。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { logger } from '../utils/logger.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { handleHealth } from './routes/health.js';
import { createEntryRoutes } from './routes/entry.js';
import { createSyncRoutes } from './routes/sync.js';
import { createImportRoutes } from './routes/import.js';
import type { WikiStore } from '../storage/WikiStore.js';
import type { RawStore } from '../storage/RawStore.js';
import type { SchemaStore } from '../storage/SchemaStore.js';
import type { ProcessingPipeline } from '../folder-manager/SyncManager.js';

export class HttpServer {
  private server: ReturnType<typeof createServer>;

  constructor(
    private port: number,
    private wikiStore: WikiStore,
    private rawStore: RawStore,
    private schemaStore: SchemaStore,
    private pipeline: ProcessingPipeline,
  ) {
    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  async start(): Promise<void> {
    return new Promise(resolve => {
      this.server.listen(this.port, '127.0.0.1', () => {
        logger.info(`HTTP server listening on 127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise(resolve => this.server.close(() => {
      logger.info('HTTP server stopped');
      resolve();
    }));
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    requestLogger(req, res);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      await this.routeRequest(req, res);
    } catch (err) {
      errorHandler(err as Error, req, res);
    }
  }

  private async routeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    const entryRoutes = createEntryRoutes(this.wikiStore);
    const syncRoutes = createSyncRoutes(this.pipeline, this.wikiStore);
    const importRoutes = createImportRoutes(this.pipeline);

    // Health check
    if (method === 'GET' && path === '/api/v1/health') {
      const stats = {
        entries: await this.wikiStore.count(),
        raw: await this.rawStore.count(),
        schema: await this.schemaStore.count(),
      };
      handleHealth(req, res, stats);
      return;
    }

    // Entries CRUD
    if (path === '/api/v1/entries') {
      if (method === 'GET') { await entryRoutes.list(req, res); return; }
      if (method === 'POST') { await entryRoutes.create(req, res); return; }
    }

    // Single entry by DNA
    const entryMatch = path.match(/^\/api\/v1\/entries\/(DNA-[A-Z0-9-]+)$/);
    if (entryMatch) {
      const dnaRootId = entryMatch[1];
      if (method === 'GET') { await entryRoutes.get(req, res, dnaRootId); return; }
      if (method === 'PUT') { await entryRoutes.update(req, res, dnaRootId); return; }
      if (method === 'DELETE') { await entryRoutes.delete(req, res, dnaRootId); return; }
    }

    // Parse single file
    if (method === 'POST' && path === '/api/v1/parse') {
      await importRoutes.parseFile(req, res);
      return;
    }

    // Import folder
    if (method === 'POST' && path === '/api/v1/import') {
      await importRoutes.importFolder(req, res);
      return;
    }

    // Sync
    if (path === '/api/v1/sync/status' && method === 'GET') {
      await syncRoutes.status(req, res);
      return;
    }
    if (path === '/api/v1/sync/trigger' && method === 'POST') {
      await syncRoutes.trigger(req, res);
      return;
    }

    // Stats
    if (method === 'GET' && path === '/api/v1/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        data: {
          entries: await this.wikiStore.count(),
          rawAttachments: await this.rawStore.count(),
          schemaIndexes: await this.schemaStore.count(),
        },
      }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: false,
      error: { code: 'NOT_FOUND', message: `Route not found: ${method} ${path}` },
    }));
  }
}
