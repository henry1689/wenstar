/**
 * entry — 词条 CRUD 路由
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WikiStore } from '../../storage/WikiStore.js';
import { DnaGenerator } from '../../core/DnaGenerator.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';

const dnaGenerator = new DnaGenerator();

export function createEntryRoutes(store: WikiStore) {
  return {
    async list(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const query = url.searchParams.get('q') || undefined;
      const tags = url.searchParams.get('tags')?.split(',').filter(Boolean);
      const type = url.searchParams.get('type') || undefined;
      const page = parseInt(url.searchParams.get('page') || '1', 10);
      const pageSize = parseInt(url.searchParams.get('page_size') || '20', 10);

      const result = await store.search({ query, tags, type, page, pageSize });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        data: result.entries,
        meta: { total: result.total, page, page_size: pageSize },
      }));
    },

    async get(_req: IncomingMessage, res: ServerResponse, dnaRootId: string): Promise<void> {
      const entry = await store.getByDna(dnaRootId);
      if (!entry) throw new NotFoundError(`Entry not found: ${dnaRootId}`);

      await store.incrementRecall(dnaRootId);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: entry }));
    },

    async create(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const body = await readJsonBody(req);
      if (!body.content) throw new ValidationError('content is required');

      const dnaRootId = body.dna_root_id || dnaGenerator.generateRootId('api');
      const entry = {
        dna_root_id: dnaRootId,
        title: body.title || 'untitled',
        type: body.type || 'note',
        content: body.content,
        summary: body.summary,
        tags: body.tags ? JSON.stringify(body.tags) : undefined,
        source_dna: body.source_dna,
      };

      const id = await store.create(entry);
      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: { id, ...entry } }));
    },

    async update(req: IncomingMessage, res: ServerResponse, dnaRootId: string): Promise<void> {
      const existing = await store.getByDna(dnaRootId);
      if (!existing) throw new NotFoundError(`Entry not found: ${dnaRootId}`);

      const body = await readJsonBody(req);
      const updated = await store.update({
        dna_root_id: dnaRootId,
        title: body.title,
        content: body.content,
        summary: body.summary,
        tags: body.tags ? JSON.stringify(body.tags) : undefined,
        type: body.type,
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: { updated } }));
    },

    async delete(_req: IncomingMessage, res: ServerResponse, dnaRootId: string): Promise<void> {
      const result = await store.deleteByDna(dnaRootId);
      if (!result) throw new NotFoundError(`Entry not found: ${dnaRootId}`);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: { deleted: true } }));
    },
  };
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const buffers: Buffer[] = [];
  for await (const chunk of req) {
    buffers.push(chunk);
  }
  const raw = Buffer.concat(buffers).toString('utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError('Invalid JSON body');
  }
}
