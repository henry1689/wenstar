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
import type { Perception24D } from '../../m3/types/perception.js';
import { parseFile } from './FileUploadService.js';
import { FileChunker } from '../tools/FileChunker.js';

// 文件切片器实例（段落策略，每块 500 字符，50 重叠）
const fileChunker = new FileChunker({ strategy: 'paragraph', chunkSize: 500, overlap: 50, minChunkLen: 20 });
import { createLocalEmbedding } from './EmbeddingProvider.js';
import { VectorStore } from './VectorStore.js';
import { hybridSearch } from './RAGPipeline.js';
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { LocalCache } from '../tools/LocalCache.js';
import { fileURLToPath } from 'node:url';

// ── MD 同步路径 ──
const __MD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'knowledge-md');

// ── 知识柜分类路径 ──
const __KC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'knowledge-cabinet');
const __KC_DOCS = join(__KC_ROOT, 'docs');
const __KC_IMG = join(__KC_ROOT, 'images');
const __KC_VID = join(__KC_ROOT, 'videos');
const __KC_DATA = join(__KC_ROOT, 'data');

/** source_type → 分类文件夹映射 */
const CABINET_MAP: Record<string, string> = {
  txt: 'docs', md: 'docs', text: 'docs', protocol: 'docs', person: 'docs',
  research: 'docs', query: 'docs', important: 'docs', paste: 'docs',
  jpg: 'images', jpeg: 'images', png: 'images', gif: 'images',
  bmp: 'images', webp: 'images', svg: 'images',
  mp4: 'videos', avi: 'videos', mov: 'videos', mkv: 'videos', webm: 'videos',
};
const CABINET_DIRS: Record<string, string> = {
  docs: __KC_DOCS, images: __KC_IMG, videos: __KC_VID, data: __KC_DATA,
};

/** 获取安全的文件名 */
function safeFileName(title: string, sourceType: string): string {
  const ext = sourceType === 'md' ? '.md'
    : ['jpg','jpeg','png','gif','bmp','webp','svg'].includes(sourceType) ? '.' + sourceType
    : sourceType === 'mp4' || sourceType === 'avi' || sourceType === 'mov' || sourceType === 'mkv' || sourceType === 'webm' ? '.' + sourceType
    : sourceType === 'xlsx' ? '.xlsx' : sourceType === 'xls' ? '.xls'
    : sourceType === 'csv' ? '.csv' : sourceType === 'pdf' ? '.pdf'
    : sourceType === 'docx' ? '.docx' : sourceType === 'json' ? '.json'
    : '.txt';
  const base = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().substring(0, 80);
  return base + ext;
}

/** 同步条目到知识柜分类文件夹 */
function syncToCabinet(entry: KnowledgeItem, remove = false): void {
  try {
    const folder = CABINET_MAP[entry.source_type] || 'data';
    const dir = CABINET_DIRS[folder] || __KC_DATA;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const fname = safeFileName(entry.title, entry.source_type);
    const fpath = join(dir, fname);
    if (remove) {
      if (existsSync(fpath)) unlinkSync(fpath);
      return;
    }
    writeFileSync(fpath, entry.content || '', 'utf-8');
  } catch (err) {
    console.warn('[KE→KC] 同步失败:', err);
  }
}

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
/** P2: 检索缓存（30秒TTL） */
const searchCache = new LocalCache<string, KnowledgeItem[]>({ ttlMs: 30_000, namespace: 'kb_search' });
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
    classification: r.classification as string | undefined,
    classification_pending: r.classification_pending === 1 || r.classification_pending === true,
    dna_id: r.dna_id as string | undefined,
    scene_tags: r.scene_tags as string | undefined,
    interaction_type: r.interaction_type as string | undefined,
    emotion_vector: r.emotion_vector as string | undefined,
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
  const chunkResult = fileChunker.chunkWithSummary({ text: content, source: knId });
  if (chunkResult.chunks.length === 0) return;

  // 清除旧分块
  sqlite.writeRaw(`DELETE FROM knowledge_chunks WHERE kn_id = ?`, knId);
  const removed = vectorStore.removeByPrefix(knId);

  // P0: 批量嵌入 — 减少 API 调用次数
  const chunkTexts = chunkResult.chunks.map(function(c) { return c.content; });
  const embeddings = embedProvider.isAvailable() ? await embedProvider.embedBatch(chunkTexts).catch(function() { return []; }) : [];

  for (let ci = 0; ci < chunkResult.chunks.length; ci++) {
    const chunk = chunkResult.chunks[ci];
    const chunkId = `${knId}_${chunk.index}`;
    const embedding = embeddings[ci] || [];

    // 存 SQLite
    sqlite.writeRaw(
      `INSERT OR REPLACE INTO knowledge_chunks (id, kn_id, chunk_index, chunk_text, embedding)
       VALUES (?, ?, ?, ?, ?)`,
      chunkId, knId, chunk.index, chunk.content,
      embedding.length > 0 ? JSON.stringify(embedding) : null,
    );

    // 存向量索引
    if (embedding.length > 0) {
      vectorStore.upsert(chunkId, embedding);
    }
  }
}

export function createKnowledgeEngine(sqlite: SQLiteAdapter) {
  /** 新增（自动分块 + 嵌入 + 情绪关联 + 交互分类） */
  async function add(params: {
    title: string;
    content: string;
    source_type?: string;
    source_name?: string;
    file_size?: number;
    tags?: string[];
    /** 关联的情绪上下文（pleasure, arousal, intimacy 等关键维度） */
    emotionalContext?: { pleasure: number; arousal: number; intimacy: number };
    /** 知识分类（铁律：无分类不检索 — 不传则标记为待分类） */
    classification?: string;
    /** P0: 关联的 M1 DNA ID */
    dna_id?: string;
    /** P0: 关联场景标签（逗号分隔或数组） */
    scene_tags?: string | string[];
    /** P0: 交互型分类 */
    interaction_type?: string;
    /** P0: 情感曲谱（24D 感知向量 JSON） */
    emotion_vector?: string;
  }): Promise<KnowledgeItem> {
    const id = `kn_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const allTags = [...(params.tags ?? [])];
    if (params.emotionalContext) {
      const e = params.emotionalContext;
      allTags.push(`emotion:p${e.pleasure.toFixed(2)}_a${e.arousal.toFixed(2)}_i${e.intimacy.toFixed(2)}`);
    }
    // 无分类标记为待分类
    const hasClassification = !!params.classification;
    const classification = params.classification || null;
    const classificationPending = hasClassification ? 0 : 1;

    // 标准化 scene_tags
    const sceneTagsStr = Array.isArray(params.scene_tags)
      ? params.scene_tags.join(',')
      : (params.scene_tags ?? null);

    const entry: KnowledgeItem = {
      id, title: params.title, content: params.content,
      source_type: params.source_type ?? 'text', source_name: params.source_name ?? null,
      file_size: params.file_size ?? 0, tags: allTags,
      created_at: now, updated_at: now, locked: false,
      classification: classification || undefined,
      classification_pending: !hasClassification,
      dna_id: params.dna_id,
      scene_tags: sceneTagsStr ?? undefined,
      interaction_type: params.interaction_type ?? 'other',
      emotion_vector: params.emotion_vector,
    };
    sqlite.writeRaw(
      `INSERT INTO knowledge_base (id, title, content, source_type, source_name, file_size, tags, created_at, updated_at, locked, classification, classification_pending, dna_id, scene_tags, interaction_type, emotion_vector)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id, entry.title, entry.content, entry.source_type,
      entry.source_name, entry.file_size, JSON.stringify(entry.tags),
      entry.created_at, entry.updated_at, entry.locked ? 1 : 0,
      classification, classificationPending ? 1 : 0,
      entry.dna_id ?? null, entry.scene_tags ?? null,
      entry.interaction_type ?? 'other', entry.emotion_vector ?? null,
    );

    // 异步分块 + 嵌入（不阻塞返回）
    syncToCabinet(entry);
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
    syncToCabinet(updated);
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
    syncToCabinet(existing, true); // 删除知识柜文件
    syncToMd(existing, true); // 删除 MD 文件
    sqlite.writeRaw(`DELETE FROM knowledge_base WHERE id=?`, id);
    sqlite.writeRaw(`DELETE FROM knowledge_chunks WHERE kn_id=?`, id);
    vectorStore.removeByPrefix(id);
    return true;
  }

  /** 搜索（混合检索：向量语义 + 关键词 + 情绪关联 + 交互型分类过滤 + 缓存） */
  async function search(keyword: string, limit = 10, emotionalContext?: { pleasure: number; arousal: number; intimacy: number }, interactionType?: string): Promise<KnowledgeItem[]> {
    // LIKE 后备搜索函数（支持按 interaction_type 过滤）
    const keywordSearch = (kw: string, lim: number) => {
      let sql = `SELECT * FROM knowledge_base WHERE (content LIKE ? OR title LIKE ?)`;
      const params: any[] = [`%${kw}%`, `%${kw}%`];
      if (interactionType) {
        sql += ` AND interaction_type = ?`;
        params.push(interactionType);
      }
      sql += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(lim);
      return sqlite.queryAll(sql, params).map(rowToEntry);
    };

    const trimmed = keyword.trim();
    if (!trimmed) return keywordSearch('', limit);

    // P2: 缓存检查
    const cacheKey = trimmed + '_' + (interactionType || '') + '_' + limit;
    const cached = await searchCache.get(cacheKey);
    if (cached) { return cached; }

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

    // P2: 缓存结果 + 质量报告
    searchCache.set(cacheKey, results).catch(function() {});
    if (results.length > 0) {
      const avgScore = results.reduce(function(s: number, r: any) { return s + (r.matchScore || 0.5); }, 0) / results.length;
      console.log('[KB] 检索: ' + trimmed.substring(0,20) + ' → ' + results.length + '条 (均分' + avgScore.toFixed(2) + ')');
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

  /** 按场景标签检索知识（优先匹配 interaction_type + scene_tags） */
  function searchByScene(sceneTags: string[], limit = 5, emotionType?: string): KnowledgeItem[] {
    if (!sceneTags.length) return [];
    const conditions = sceneTags.map(() => `scene_tags LIKE ?`).join(' OR ');
    const params: any[] = sceneTags.map(t => `%${t}%`);
    let sql = `SELECT * FROM knowledge_base WHERE (${conditions}) AND classification_pending = 0`;
    if (emotionType) {
      sql += ` ORDER BY CASE WHEN tags LIKE ? THEN 0 ELSE 1 END, updated_at DESC LIMIT ?`;
      params.unshift(`%${emotionType}%`);
    } else {
      sql += ` ORDER BY updated_at DESC LIMIT ?`;
    }
    params.push(limit);
    return sqlite.queryAll(sql, params).map(rowToEntry);
  }

  // ─── 辅助：计算两个逗号分隔的 scene_tags 字符串的 Jaccard 相似度 ───
  function jaccardScene(a: string | null | undefined, b: string[]): number {
    if (!a || !b.length) return 0;
    const setA = new Set(a.split(',').map(s => s.trim()).filter(Boolean));
    if (!setA.size) return 0;
    const setB = new Set(b.map(s => s.trim()).filter(Boolean));
    let intersection = 0;
    for (const tag of setA) if (setB.has(tag)) intersection++;
    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? intersection / union : 0;
  }

  // ─── 辅助：解析 emotion_vector JSON → number[] ───
  function parseEmotionVector(ev: string | null | undefined): number[] | null {
    if (!ev) return null;
    try { const arr = JSON.parse(ev); return Array.isArray(arr) ? arr : null; } catch { return null; }
  }

  // ─── 辅助：计算两个 24D 向量的余弦相似度 ───
  function cosineSimilarity(a: number[], b: Perception24D | { pleasure: number; arousal: number; intimacy: number }): number {
    // 从 Perception24D 提取关键维度做向量 (pleasure, arousal, dominance, intimacy, sexual_attraction, safety)
    const bVec = [b.pleasure ?? 0, b.arousal ?? 0, (b as any).dominance ?? 0, b.intimacy ?? 0, (b as any).sexual_attraction ?? 0, (b as any).safety ?? 0.5];
    const aLen = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const bLen = Math.sqrt(bVec.reduce((s, v) => s + v * v, 0));
    if (aLen === 0 || bLen === 0) return 0;
    let dot = 0;
    for (let i = 0; i < Math.min(a.length, bVec.length); i++) dot += a[i] * bVec[i];
    return dot / (aLen * bLen);
  }

  /** 加权检索：场景标签 × 0.4 + 情感关联 × 0.3 + 文本相似度 × 0.3
   *
   * 返回带 matchScore 和 breakdown 的结构化结果。
   * 当 sceneScore 普遍低于 0.1 时，自动触发"情感相似场景知识迁移"降级。
   *
   * @param keyword 搜索关键词
   * @param sceneTags 当前场景标签列表
   * @param perception 当前情感感知（至少包含 pleasure/arousal/intimacy）
   * @param limit 最大返回条数
   */
  async function weightedSearch(
    keyword: string,
    sceneTags: string[],
    perception?: { pleasure: number; arousal: number; intimacy: number },
    limit = 5,
  ): Promise<Array<KnowledgeItem & { matchScore: number; breakdown: { scene: number; emotion: number; text: number } }>> {
    const trimmed = (keyword || '').trim();
    const keywords = trimmed ? trimmed.match(/[一-龥a-zA-Z]{2,}/g) || [trimmed] : [];

    // 构建 SQL：匹配 scene_tags 或 content/title
    const sceneCond = sceneTags.length > 0
      ? '(' + sceneTags.map(() => `scene_tags LIKE ?`).join(' OR ') + ')'
      : null;
    const textCond = keywords.length > 0
      ? '(' + keywords.map(() => `content LIKE ? OR title LIKE ?`).join(' OR ') + ')'
      : null;

    const params: any[] = [];
    if (sceneCond) params.push(...sceneTags.map(t => `%${t}%`));
    if (textCond) params.push(...keywords.flatMap(kw => [`%${kw}%`, `%${kw}%`]));

    const whereClause = [sceneCond, textCond].filter(Boolean).join(' OR ');
    // S2-1: 不再强制 classification_pending = 0，所有条目都可检索
    const sql = `SELECT * FROM knowledge_base WHERE ${whereClause} ORDER BY updated_at DESC LIMIT 50`;

    const rows = sqlite.queryAll(sql, params);
    if (!rows.length) return [];

    // 对每条结果计算得分
    const scored: Array<{ item: KnowledgeItem; scene: number; emotion: number; text: number; pending: boolean }> = [];
    const maxPossibleHits = keywords.length || 1;

    for (const row of rows) {
      const item = rowToEntry(row);
      const isPending = !!(row as any).classification_pending;

      // 场景匹配度 (0-1)
      const sceneScore = jaccardScene(item.scene_tags, sceneTags);

      // 情感匹配度 (0-1)
      let emotionScore = 0;
      if (perception) {
        const ev = parseEmotionVector(item.emotion_vector);
        if (ev) {
          emotionScore = Math.max(0, cosineSimilarity(ev, perception));
        } else {
          // 没有 emotion_vector 的知识=0.3中性分（不惩罚也不特别推荐）
          emotionScore = 0.3;
        }
      }

      // 文本相似度 (0-1)
      let textScore = 0;
      if (keywords.length > 0) {
        const combined = (item.title + item.content).toLowerCase();
        let hits = 0;
        for (const kw of keywords) {
          if (combined.includes(kw.toLowerCase())) hits++;
        }
        textScore = Math.min(hits / maxPossibleHits, 1);
      } else {
        textScore = 0.5; // 无关键词时给中性分
      }

      scored.push({ item, scene: sceneScore, emotion: emotionScore, text: textScore, pending: isPending });
    }

    // S2-1: 未分类条目分数打折（×0.7），但不屏蔽
    const classificationPenalty = (item: { pending: boolean }) => item.pending ? 0.7 : 1.0;

    // 按 40/30/30 公式计算总分（已分类正常，未分类打折）
    let results = scored.map(({ item, scene, emotion, text, pending }) => ({
      ...item,
      matchScore: Math.round((scene * 0.4 + emotion * 0.3 + text * 0.3) * (pending ? 0.7 : 1.0) * 1000) / 1000,
      breakdown: { scene: Math.round(scene * 1000) / 1000, emotion: Math.round(emotion * 1000) / 1000, text: Math.round(text * 1000) / 1000 },
    }));

    // 按 matchScore 降序
    results.sort((a, b) => b.matchScore - a.matchScore);

    // 情感相似场景知识迁移：如果最佳结果的 sceneScore < 0.1，按 emotionScore 降维再搜一轮
    if (results.length > 0 && results[0].breakdown.scene < 0.1 && perception) {
      // 降低场景权重，提升情感权重：重新排序
      const fallback = scored.map(({ item, scene, emotion, text, pending }) => ({
        ...item,
        matchScore: Math.round((emotion * 0.6 + text * 0.3 + scene * 0.1) * (pending ? 0.7 : 1.0) * 1000) / 1000,
        breakdown: { scene: Math.round(scene * 1000) / 1000, emotion: Math.round(emotion * 1000) / 1000, text: Math.round(text * 1000) / 1000 },
      }));
      fallback.sort((a, b) => b.matchScore - a.matchScore);
      results = fallback;
    }

    return results.slice(0, limit);
  }

  /** 按交互型分类检索知识 */
  function searchByInteraction(interactionType: string, limit = 10): KnowledgeItem[] {
    return sqlite.queryAll(
      `SELECT * FROM knowledge_base WHERE interaction_type = ? AND classification_pending = 0 ORDER BY updated_at DESC LIMIT ?`,
      [interactionType, limit],
    ).map(rowToEntry);
  }

  /** 更新知识分类（玉瑶反问用户后获得分类信息时调用） */
  async function updateClassification(id: string, classification: string): Promise<boolean> {
    const existing = getById(id);
    if (!existing) return false;
    sqlite.writeRaw(
      `UPDATE knowledge_base SET classification = ?, classification_pending = 0, updated_at = ? WHERE id = ?`,
      classification, new Date().toISOString(), id,
    );
    console.log(`[KE] 已分类: ${classification} → ${existing.title.substring(0, 30)}`);
    return true;
  }

  /** 获取所有待分类的知识条目（玉瑶据此生成反问） */
  function getUnclassified(limit = 10): KnowledgeItem[] {
    return sqlite.queryAll(
      `SELECT * FROM knowledge_base WHERE classification_pending = 1 ORDER BY created_at DESC LIMIT ?`, [limit],
    ).map(rowToEntry);
  }

  /** 获取创建时间超过指定天数仍未分类的条目（用于玉瑶隔几天提醒一次） */
  function getUnclassifiedOlderThan(days: number, limit = 5): KnowledgeItem[] {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return sqlite.queryAll(
      `SELECT * FROM knowledge_base WHERE classification_pending = 1 AND created_at < ? ORDER BY created_at ASC LIMIT ?`,
      [cutoff, limit],
    ).map(rowToEntry);
  }

  /**
   * 彻底移除超过指定天数仍未分类的垃圾条目（铁律：3个月无分类视为垃圾）
   * 同时清理关联的 knowledge_chunks 和 knowledge_memories
   */
  function deleteExpiredUnclassified(maxAgeDays: number): number {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    const expired = sqlite.queryAll(
      `SELECT id FROM knowledge_base WHERE classification_pending = 1 AND created_at < ?`,
      [cutoff],
    );
    const ids = expired.map((r: any) => r.id as string);
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    sqlite.writeRaw(`DELETE FROM knowledge_chunks WHERE kn_id IN (${placeholders})`, ...ids);
    sqlite.writeRaw(`DELETE FROM knowledge_memories WHERE knowledge_id IN (${placeholders})`, ...ids);
    sqlite.writeRaw(`DELETE FROM knowledge_base WHERE id IN (${placeholders})`, ...ids);
    console.log(`[KE] 垃圾清理: 移除 ${ids.length} 条超过 ${maxAgeDays} 天未分类的知识条目`);
    return ids.length;
  }

  return {
    add, list, getById, update, delete: remove,
    search, count, upload, reindexAll,
    vectorSearchDebug, embedProvider, vectorStore,
    updateClassification, getUnclassified,
    getUnclassifiedOlderThan, deleteExpiredUnclassified,
    searchByScene, searchByInteraction,
    weightedSearch,
  };
}
