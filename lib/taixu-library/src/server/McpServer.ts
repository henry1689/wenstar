/**
 * McpServer — MCP 协议服务
 *
 * 通过标准输入/输出与 MCP 客户端通信。
 * 供 Obsidian 等第三方工具对接。
 * 使用 JSON-RPC over stdio 协议。
 */

import { logger } from '../utils/logger.js';
import type { WikiStore } from '../storage/WikiStore.js';
import type { ProcessingPipeline } from '../folder-manager/SyncManager.js';

interface McpRequest {
  id: number;
  method: string;
  params: any;
}

interface McpResponse {
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

export const MCP_TOOL_DEFINITION = {
  name: 'taixu_library',
  description: '太虚图书馆知识管理工具 — 检索、创建、更新、删除知识词条，同步文件夹',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['search', 'get', 'create', 'update', 'delete', 'sync',
               'list_tags', 'stats'],
        description: '操作类型',
      },
      query: { type: 'string', description: '搜索关键词' },
      dna_root_id: { type: 'string', description: '词条 DNA 根码' },
      title: { type: 'string', description: '词条标题' },
      content: { type: 'string', description: '词条内容' },
      type: { type: 'string', description: '词条类型: memo/reference/note/article' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '标签列表',
      },
      page: { type: 'number', description: '页码' },
      page_size: { type: 'number', description: '每页数量' },
    },
    required: ['action'],
  },
};

export class McpServer {
  private buffer = '';

  constructor(
    private wikiStore: WikiStore,
    private pipeline: ProcessingPipeline,
  ) {}

  start(): void {
    process.stdin.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const request: McpRequest = JSON.parse(trimmed);
          this.handleRequest(request).then(response => {
            process.stdout.write(JSON.stringify(response) + '\n');
          });
        } catch (err) {
          logger.error('MCP parse error:', err);
        }
      }
    });

    logger.info('MCP server ready (stdio transport)');
  }

  private async handleRequest(request: McpRequest): Promise<McpResponse> {
    try {
      switch (request.method) {
        case 'list_tools':
          return { id: request.id, result: { tools: [MCP_TOOL_DEFINITION] } };

        case 'call_tool':
          return {
            id: request.id,
            result: await this.handleToolCall(request.params?.arguments || {}),
          };

        default:
          return {
            id: request.id,
            error: { code: -32601, message: `Method not found: ${request.method}` },
          };
      }
    } catch (err) {
      return {
        id: request.id,
        error: { code: -32603, message: String(err) },
      };
    }
  }

  private async handleToolCall(params: any): Promise<any> {
    const action = params.action;

    switch (action) {
      case 'search': {
        const result = await this.wikiStore.search({
          query: params.query,
          page: params.page || 1,
          pageSize: params.page_size || 20,
        });
        return { entries: result.entries, total: result.total };
      }

      case 'get': {
        const entry = await this.wikiStore.getByDna(params.dna_root_id);
        if (!entry) throw new Error(`Entry not found: ${params.dna_root_id}`);
        await this.wikiStore.incrementRecall(params.dna_root_id);
        return { entry };
      }

      case 'create': {
        const { DnaGenerator } = await import('../core/DnaGenerator.js');
        const dnaGenerator = new DnaGenerator();
        const dnaRootId = params.dna_root_id || dnaGenerator.generateRootId('mcp');
        const id = await this.wikiStore.create({
          dna_root_id: dnaRootId,
          title: params.title || 'untitled',
          type: params.type || 'note',
          content: params.content || '',
          tags: params.tags ? JSON.stringify(params.tags) : undefined,
        });
        return { id, dna_root_id: dnaRootId };
      }

      case 'update': {
        const updated = await this.wikiStore.update({
          dna_root_id: params.dna_root_id,
          title: params.title,
          content: params.content,
          tags: params.tags ? JSON.stringify(params.tags) : undefined,
          type: params.type,
        });
        return { updated };
      }

      case 'delete': {
        const result = await this.wikiStore.deleteByDna(params.dna_root_id);
        return { deleted: result };
      }

      case 'sync': {
        const report = await this.pipeline.syncAll();
        return { report };
      }

      case 'list_tags': {
        const result = await this.wikiStore.search({ pageSize: 100 });
        const allTags = new Set<string>();
        for (const entry of result.entries) {
          if (entry.tags) {
            try {
              const tags = JSON.parse(entry.tags);
              for (const tag of tags) allTags.add(tag);
            } catch {}
          }
        }
        return { tags: [...allTags] };
      }

      case 'stats': {
        const count = await this.wikiStore.count();
        return { entriesCount: count };
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}
