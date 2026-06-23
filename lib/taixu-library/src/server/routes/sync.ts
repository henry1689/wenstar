/**
 * sync — 同步路由
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProcessingPipeline } from '../../folder-manager/SyncManager.js';
import type { WikiStore } from '../../storage/WikiStore.js';

export function createSyncRoutes(
  pipeline: ProcessingPipeline,
  wikiStore: WikiStore,
) {
  return {
    async status(_req: IncomingMessage, res: ServerResponse): Promise<void> {
      const count = await wikiStore.count();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        data: {
          entriesCount: count,
          lastSync: null,
          autoSync: true,
        },
      }));
    },

    async trigger(_req: IncomingMessage, res: ServerResponse): Promise<void> {
      const report = await pipeline.syncAll();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: report }));
    },
  };
}
