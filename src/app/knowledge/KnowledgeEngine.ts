/**
 * KnowledgeEngine — 知识引擎（应用层）
 *
 * 整合向量搜索 + RAG 管道：
 * - add/upload 时自动分块、嵌入、索引
 * - search 时混合检索（向量语义 + 关键词 LIKE）
 * - API 不可用时自动降级为纯 LIKE
 */
import type { SQLiteAdapter } from '../../m2/SQLiteAdapter.js';
import type { KnowledgeItem } from './types.js';
import { parseFile } from './FileUploadService.js';
import { chunkText } from './ChunkService.js';
import { createLocalEmbedding } from './EmbeddingProvider.js';
import { VectorStore } from './VectorStore.js';
import { hybridSearch } from './RAGPipeline.js';
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── MD 同步路径 ──
const __MD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'knowledge-md');

/** 同步条目到 Markdown 文件 */
function syncToMd(entry: KnowledgeItem, remove = false): void {
  try {
    if (!existsSync(__MD_DIR)) mkdirSync(__MD_DIR, { recursive: true });
    const fname = entry.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().substring(0, 80) + '.md';
    const fpath = join(__MD_DIR, fname);
    if (remove) {
      if (existsSync(fpath)) unlinkSync(fpath);
      return;
    }
    const tags = Array.isArray(entry.tags) ? '\n' + entry.tags.map((t: string) => `  - "${t}"`).join('\n') : '';
    const frontmatter = `---
id: "${entry.id}"
title: "${entry.title}"
type: "${entry.source_type}"
source_type: "${entry.source_type}"
created_at: "${entry.created_at}"
updated_at: "${entry.updated_at}"
${entry.source_name ? `source_name: "${entry.source_name}"\n` : ''}${entry.file_size ? `file_size: ${entry.file_size}\n` : ''}${tags ? `tags:${tags}\n` : ''}---\n\n`;
    writeFileSync(fpath, frontmatter + (entry.content || ''), 'utf-8');
  } catch (err) {
    console.warn('[KE→MD] 同步失败:', err);
  }
}

// ── 模块级单例（跨多次 createKnowledgeEngine 调用持久化） ──
const vectorStore = new VectorStore();
const embedProvider = createLocalEmbedding();
let _indexReady = false;

function rowToEntry(r: Record<string, any>): KnowledgeItem {
  return {
    id: r.id as string,
    title: r.title as string,
    content: r.content as string,
    source_type: r.source_type as string,
    source_name: r.source_name as string | null,
    file_size: r.file_size as number,
    tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : (r.tags ?? []),
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    locked: r.locked === 1 || r.locked === true,
  };
}

/** 确保向量索引已加载（懒加载） */
function ensureIndex(sqlite: SQLiteAdapter): void {
  if (_indexReady) return;
  try {
    const rows = sqlite.queryAll(
      `SELECT id, kn_id, chunk_text, embedding FROM knowledge_chunks WHERE embedding IS NOT NULL LIMIT 5000`,
    );
    for (const row of rows) {
      const emb = row.embedding as string;
      if (emb) {
        try {
          vectorStore.upsert(row.id as string, JSON.parse(emb));
        } catch (err) { console.warn("[KE] embedding损坏:", err); }
      }
    }
    console.log(`[KnowledgeEngine] 向量索引已加载: ${rows.length} 个分块`);
  } catch (err) {
    console.warn('[KnowledgeEngine] 向量索引加载失败（首次运行正常）:', err);
  }
  _indexReady = true;
}

/** 为一个知识条目创建分块 + 嵌入 + 索引 */
async function indexContent(
  sqlite: SQLiteAdapter,
  knId: string,
  content: string,
): Promise<void> {
  ensureIndex(sqlite);
  const chunks = chunkText(content);
  if (chunks.length === 0) return;

  // 清除旧分块
  sqlite.writeRaw(`DELETE FROM knowledge_chunks WHERE kn_id = ?`, knId);
  const removed = vectorStore.removeByPrefix(knId);

  for (const chunk of chunks) {
    const chunkId = `${knId}_${chunk.index}`;
    let embedding: number[] = [];

    // 尝试嵌入
    if (embedProvider.isAvailable()) {
      try {
        embedding = await embedProvider.embed(chunk.text);
      } catch (err) {
        console.warn("[KE] 嵌入失败:", err instanceof Error ? err.message : String(err));
        // 嵌入失败，跳过
      }
    }

    // 存 SQLite
    sqlite.writeRaw(
      `INSERT OR REPLACE INTO knowledge_chunks (id, kn_id, chunk_index, chunk_text, embedding)
       VALUES (?, ?, ?, ?, ?)`,
      chunkId, knId, chunk.index, chunk.text,
      embedding.length > 0 ? JSON.stringify(embedding) : null,
    );

    // 存向量索引
    if (embedding.length > 0) {
      vectorStore.upsert(chunkId, embedding);
    }
  }
}

export function createKnowledgeEngine(sqlite: SQLiteAdapter) {
  /** 新增（自动分块 + 嵌入 + 情绪关联） */
  async function add(params: {
    title: string;
    content: string;
    source_type?: string;
    source_name?: string;
    file_size?: number;
    tags?: string[];
    /** 关联的情绪上下文（pleasure, arousal, intimacy 等关键维度） */
    emotionalContext?: { pleasure: number; arousal: number; intimacy: number };
  }): Promise<KnowledgeItem> {
    const id = `kn_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const allTags = [...(params.tags ?? [])];
    // 将情绪编码到标签中
    if (params.emotionalContext) {
      const e = params.emotionalContext;
      allTags.push(`emotion:p${e.pleasure.toFixed(2)}_a${e.arousal.toFixed(2)}_i${e.intimacy.toFixed(2)}`);
    }
    const entry: KnowledgeItem = {
      id, title: params.title, content: params.content,
      source_type: params.source_type ?? 'text', source_name: params.source_name ?? null,
      file_size: params.file_size ?? 0, tags: allTags,
      created_at: now, updated_at: now, locked: false,
    };
    sqlite.writeRaw(
      `INSERT INTO knowledge_base (id, title, content, source_type, source_name, file_size, tags, created_at, updated_at, locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id, entry.title, entry.content, entry.source_type,
      entry.source_name, entry.file_size, JSON.stringify(entry.tags),
      entry.created_at, entry.updated_at, entry.locked ? 1 : 0,
    );

    // 异步分块 + 嵌入（不阻塞返回）
    syncToMd(entry);
    indexContent(sqlite, id, params.content).catch(err =>
      console.warn(`[KnowledgeEngine] 索引失败 ${id}:`, err),
    );

    return entry;
  }

  /** 列表 */
  function list(limit = 50): KnowledgeItem[] {
    return sqlite.queryAll(
      `SELECT * FROM knowledge_base ORDER BY created_at DESC LIMIT ?`, [limit],
    ).map(rowToEntry);
  }

  /** 按 ID 查询 */
  function getById(id: string): KnowledgeItem | null {
    const rows = sqlite.queryAll(`SELECT * FROM knowledge_base WHERE id = ? LIMIT 1`, [id]);
    return rows.length > 0 ? rowToEntry(rows[0]) : null;
  }

  /** 更新（重新分块 + 嵌入） */
  async function update(id: string, params: {
    title?: string; content?: string; tags?: string[]; locked?: boolean;
  }): Promise<boolean> {
    const existing = getById(id);
    if (!existing || existing.locked) return false;
    const now = new Date().toISOString();
    sqlite.writeRaw(
      `UPDATE knowledge_base SET title=?, content=?, tags=?, locked=?, updated_at=? WHERE id=?`,
      params.title ?? existing.title, params.content ?? existing.content,
      JSON.stringify(params.tags ?? existing.tags),
      (params.locked ?? existing.locked) ? 1 : 0, now, id,
    );
    // 同步到 Markdown 文件
    const updated = { ...existing, ...params, updated_at: now, tags: params.tags ?? existing.tags };
    syncToMd(updated);
    // 内容变了就重新索引
    if (params.content && params.content !== existing.content) {
      indexContent(sqlite, id, params.content).catch(() => {});
    }
    return true;
  }

  /** 删除（同时清理索引 + MD 文件） */
  function remove(id: string): boolean {
    const existing = getById(id);
    if (!existing) return false;
    syncToMd(existing, true); // 删除 MD 文件
    sqlite.writeRaw(`DELETE FROM knowledge_base WHERE id=?`, id);
    sqlite.writeRaw(`DELETE FROM knowledge_chunks WHERE kn_id=?`, id);
    vectorStore.removeByPrefix(id);
    return true;
  }

  /** 搜索（混合检索：向量语义 + 关键词 + 情绪关联） */
  async function search(keyword: string, limit = 10, emotionalContext?: { pleasure: number; arousal: number; intimacy: number }): Promise<KnowledgeItem[]> {
    // LIKE 后备搜索函数
    const keywordSearch = (kw: string, lim: number) =>
      sqlite.queryAll(
        `SELECT * FROM knowledge_base WHERE content LIKE ? OR title LIKE ?
         ORDER BY created_at DESC LIMIT ?`,
        [`%${kw}%`, `%${kw}%`, lim],
      ).map(rowToEntry);

    const trimmed = keyword.trim();
    if (!trimmed) return keywordSearch('', limit);

    // 1. 先用完整句子搜索
    let results = keywordSearch(trimmed, limit);

    // 2. 如果没结果，拆出 2-4 字中文词逐个搜索（解决"你在知识库看过红楼逸事吗"→"红楼逸事"）
    if (results.length === 0) {
      const words = trimmed.match(/[一-龥]{2,4}/g);
      if (words) {
        const seen = new Set<string>();
        for (const word of words) {
          if (seen.has(word)) continue;
          seen.add(word);
          const sub = keywordSearch(word, limit);
          if (sub.length > 0) {
            results = sub;
            break;
          }
        }
      }
    }

    // 3. 如果嵌入可用，走混合搜索（但不会覆盖关键词搜索结果）
    if (embedProvider.isAvailable()) {
      ensureIndex(sqlite);
      if (vectorStore.size() > 0) {
        try {
          const hybridResults = await hybridSearch(trimmed, embedProvider, vectorStore, keywordSearch, limit, emotionalContext);
          if (hybridResults.length > 0) return hybridResults;
        } catch (err) {
          console.warn('[KnowledgeEngine] 混合搜索失败，降级:', err);
        }
      }
    }

    return results;
  }

  /** 计数 */
  function count(): number {
    const rows = sqlite.queryAll(`SELECT COUNT(*) as cnt FROM knowledge_base`);
    return rows.length > 0 ? (rows[0].cnt as number) : 0;
  }

  /** 文件上传并入库 */
  async function upload(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
  ): Promise<KnowledgeItem> {
    const parsed = await parseFile(buffer, mimeType, fileName);
    return add({
      title: parsed.title,
      content: parsed.content,
      source_type: parsed.source_type,
      source_name: parsed.source_name,
      file_size: parsed.file_size,
      tags: [`source:${parsed.source_type}`],
    });
  }

  /** 强制重新索引所有已有知识条目（维护用） */
  async function reindexAll(): Promise<number> {
    ensureIndex(sqlite);
    const all = list(500);
    let indexed = 0;
    for (const item of all) {
      await indexContent(sqlite, item.id, item.content);
      indexed++;
    }
    console.log(`[KnowledgeEngine] 重新索引完成: ${indexed} 条`);
    return indexed;
  }

  /** 向量搜索调试（返回原始分块匹配） */
  function vectorSearchDebug(queryVec: number[], topK = 5): Array<{
    chunkId: string; text: string; score: number; knId: string;
  }> {
    const hits = vectorStore.similaritySearch(queryVec, topK);
    const results: Array<{ chunkId: string; text: string; score: number; knId: string }> = [];
    for (const hit of hits) {
      const rows = sqlite.queryAll(`SELECT kn_id, chunk_text FROM knowledge_chunks WHERE id = ?`, [hit.id]);
      if (rows.length > 0) {
        results.push({
          chunkId: hit.id,
          knId: rows[0].kn_id as string,
          text: (rows[0].chunk_text as string).substring(0, 100),
          score: hit.score,
        });
      }
    }
    return results;
  }

  return {
    add, list, getById, update, delete: remove,
    search, count, upload, reindexAll,
    vectorSearchDebug, embedProvider, vectorStore,
  };
}
