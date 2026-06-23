/**
 * LibraryClient — 太虚图书馆 HTTP 对接客户端
 *
 * T2: 主程序通过 HTTP 3737 与太虚图书馆通信。
 * 高钙对话自动同步为图书馆词条，图书馆文档可被 RAG 检索命中。
 * 图书馆不可用时降级不阻塞。
 */

import { config } from '../../config.js';

export interface LibraryEntry {
  dna_root_id: string;
  title: string;
  type: string;
  content: string;
  summary?: string;
  tags?: string;
  calcium?: number;
  created_at?: string;
}

export class LibraryClient {
  private baseUrl: string;
  public enabled: boolean;

  constructor() {
    this.enabled = config.library.enabled;
    this.baseUrl = `http://127.0.0.1:${config.library.port}`;
  }

  /** 同步高钙记忆至图书馆词条 */
  async syncMemory(dnaRootId: string, content: string, calcium: number, tags?: string[]): Promise<void> {
    if (!this.enabled) return;
    try {
      await fetch(`${this.baseUrl}/api/v1/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dna_root_id: dnaRootId,
          title: `记忆同步: ${content.substring(0, 40)}...`,
          content,
          type: 'note',
          tags: tags ?? ['synced-from-memory'],
          source_dna: dnaRootId,
        }),
      });
    } catch {
      // 图书馆不可用不阻塞
    }
  }

  /** 从图书馆检索知识 */
  async search(query: string, limit: number = 5): Promise<LibraryEntry[]> {
    if (!this.enabled) return [];
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/entries?q=${encodeURIComponent(query)}&page_size=${limit}`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (!res.ok) return [];
      const json = await res.json();
      return json.data ?? [];
    } catch {
      return [];
    }
  }

  /** 健康检查 */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** 触发文件夹同步 */
  async triggerSync(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/sync/trigger`, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
