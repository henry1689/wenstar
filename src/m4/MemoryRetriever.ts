// MemoryRetriever — 从 M2 检索历史记忆 + 上下文压缩
// Ref: M4-design-v1.md §4

import type { FusionStorageAdapter } from '../m2/FusionStorageAdapter.js';
import type { KnowledgeBase } from '../m2/KnowledgeBase.js';
import type { DNA } from '../m1/types/dna.js';
import type { Perception24D } from '../m3/types/perception.js';
import type { MemorySummary } from './types/index.js';
import { RETRIEVAL_THRESHOLDS, BATCH_SIZES, MIN_MATCHED_FOR_BREAK } from '../m2/retrieval-constants.js';
import { LocalCache } from '../app/tools/LocalCache.js';

// 关键词检索缓存：相同关键词 30 秒内复用结果
const keywordCache = new LocalCache<string, DNA[]>({ ttlMs: 30_000, namespace: 'm4_keyword' });

export class MemoryRetriever {
  private storage: FusionStorageAdapter;
  private knowledgeBase: KnowledgeBase | null = null;

  constructor(storage: FusionStorageAdapter, knowledgeBase?: KnowledgeBase) {
    this.knowledgeBase = knowledgeBase ?? null;
    this.storage = storage;
  }

  /**
   * 根据 M3 决策检索相关历史记忆
   *
   * 检索策略（按优先级）：
   * 1. 按 locus_path 话题前缀检索 — 分类树路由匹配
   * 2. 按实体名称 + 原始输入关键词全文搜索 — 真正的内容匹配
   * 3. 按情感相似度检索（当 entities 包含 emotion 类型时）— 跨场景同情绪记忆串联
   */
  async retrieveMemories(
    locusPath: string,
    entities: Array<{ name: string; type: string }>,
    options?: { limit?: number; perception?: Perception24D }
  ): Promise<DNA[]> {
    const limit = options?.limit ?? 5;

    // 1. 按话题前缀检索（基于分类树路由）
    const byLocus = await this.storage.findByLocus(locusPath, { limit: 20 });

    // ─── 2. 关键词全文搜索（替代已废弃的 findByLocus(entity.name)） ───
    //
    // 之前版本使用 this.storage.findByLocus(entity.name) 来"按实体搜索"，
    // 但 findByLocus 内部用 locus_path.startsWith(name) 过滤索引，
    // 而所有 locus_path 都是 "user.xxx.yyy" 格式，实体名 "我"、"画" 等永远不匹配。
    // → 实体搜索自项目诞生以来从未真正生效过。
    //
    // 修正：从最近记录中按 raw_input 包含关键词来筛选。
    const byKeyword: DNA[] = [];
    const keywords = new Set<string>();

    // 实体名称作为搜索词
    for (const e of entities) {
      if (e.name && e.name.length > 0) keywords.add(e.name);
    }

    // 从当前 locus_path 推断关键词（取最后一段）
    if (locusPath) {
      const segments = locusPath.split('.');
      const last = segments[segments.length - 1];
      if (last && last !== 'default' && last !== 'general') keywords.add(last);
    }

    if (keywords.size > 0) {
      try {
        // P3: 关键词缓存 30 秒
        const cacheKey = [...keywords].sort().join("::");
        const _cached = await keywordCache.get(cacheKey);
        if (_cached) { byKeyword.push(..._cached); }
        else {
        // 与 3001 MAX_SAVED_TURNS 对齐，覆盖完整对话上下文
        // findBySeqPosRange 默认 DESC 排序，ascending 参数不被 QueryOptions 支持
        const recent = await this.storage.findBySeqPosRange(0, 999_999_999, { limit: 200 });
        const seen = new Set<string>();
        for (const dna of recent) {
          for (const kw of keywords) {
            if (dna.raw_input.includes(kw) && !seen.has(dna.branch_id)) {
              seen.add(dna.branch_id);
              byKeyword.push(dna);
              break;
            }
          }
        }
        }
      } catch (err) {
        console.warn("[M4] 检索失败:", err);
        // 静默失败
      }
    }

    // ─── 3. 情感相似度检索（跨场景同情绪记忆串联） ───
    //
    // 触发条件放宽：有 emotion 实体 或 钙质≥1 且有感知数据 都触发
    // 改前：仅 entities.some(e => e.type === 'emotion')
    // 改后：只要情感强度足够就检索，不依赖 M1 实体提取的准确率
    const hasEmotionType = entities.some(e => e.type === 'emotion');
    const hasMeaningfulEntity = entities.some(e => e.name.length > 0 && e.type !== 'self');
    const shouldEmotionSearch = options?.perception !== undefined && (hasEmotionType || hasMeaningfulEntity);
    const byEmotion: DNA[] = [];
    if (shouldEmotionSearch && options?.perception) {
      try {
        // 使用情感向量相似度检索（按 valence/arousal 等 24 维坐标匹配）
        const scored = this.storage.findByEmotionalSimilarity({
          current_perception: options?.perception!,
          entities: entities.filter(e => e.type === 'emotion').map(e => e.name),
          similarity_mode: 'mood_congruent',
          limit: 10,
        });
        // 转换 ScoredMemory[] → DNA[]
        for (const sm of scored) {
          if (sm?.record) {
            byEmotion.push({
              branch_id: sm.record.id,
              locus_path: sm.record.locus_path ?? '',
              taxonomy_version: '1.0',
              seq_pos: sm.record.seq_pos ?? 0,
              leaf_zone: (sm.record as any).leaf_zone ?? 'language_semantic_zone',
              ref: '',
              entity_genes: (sm.record as any).entity_genes ?? [],
              raw_input: sm.record.raw_input ?? '',
              created_at: sm.record.created_at ?? '',
              calcium_score: sm.record.calcium_score,
              calcium_level: sm.record.calcium_level,
            });
          }
        }
      } catch (err) {
        console.warn('[M4] 情感检索失败:', err);
      }
    }

    // 4. 合并去重（byEmotion 优先，因为跨场景关联最为相关）
    const seen = new Set<string>();
    const merged: DNA[] = [];
    for (const dna of [...byEmotion, ...byKeyword, ...byLocus]) {
      if (!seen.has(dna.branch_id) && merged.length < limit) {
        seen.add(dna.branch_id);
        merged.push(dna);
      }
    }

    // P1: 知识库跨场景融合 — 当检索结果不足时补充
    if (merged.length < limit * 0.5 && this.knowledgeBase && options?.perception) {
      try {
        const sceneTags = locusPath ? locusPath.split('.').filter(Boolean) : [];
        const entityKws = entities.filter(function(e) { return e.name.length > 0 && e.type !== 'self'; }).map(function(e) { return e.name; });
        const kbKeywords = [...entityKws, locusPath.split('.').pop() || ''].filter(Boolean).join(' ');
        if (kbKeywords.length > 2) {
          const kbResults = await this.knowledgeBase.weightedSearch(kbKeywords, sceneTags, {
            pleasure: options.perception.pleasure,
            arousal: options.perception.arousal,
            intimacy: options.perception.intimacy,
          }, limit - merged.length);
          for (const kb of kbResults) {
            if (!seen.has('kb_' + kb.id)) {
              seen.add('kb_' + kb.id);
              merged.push({
                branch_id: 'kb_' + kb.id,
                locus_path: 'knowledge.' + (kb.classification || 'general'),
                taxonomy_version: '1.0',
                seq_pos: 0,
                leaf_zone: 'language_semantic_zone',
                ref: 'kb_' + kb.id,
                entity_genes: [],
                raw_input: kb.title + '：' + (kb.content || '').substring(0, 60),
                created_at: kb.created_at,
                calcium_score: 0,
                calcium_level: 0,
              } as DNA);
            }
          }
        }
      } catch (err) {
        console.warn('[M4] 知识库检索失败:', err);
      }
    }

    return merged;
  }

  /**
   * 上下文窗口压缩 — 将多条 DNA 压缩为自然语言摘要
   */
  compressMemories(dnas: DNA[]): MemorySummary {
    if (dnas.length === 0) {
      return {
        timeline: [],
        frequentEntities: [],
        timeSpan: { earliest: '', latest: '' },
      };
    }

    const timeline = dnas.map((dna) => ({
      time: dna.created_at,
      summary: dna.raw_input.length > 60
        ? dna.raw_input.substring(0, 60) + '...'
        : dna.raw_input,
      calcium_level: dna.calcium_level ?? 1,
    }));

    // 统计高频实体（从 raw_input 中粗略提取）
    const freqMap = new Map<string, { type: string; count: number }>();
    for (const dna of dnas) {
      for (const gene of dna.entity_genes) {
        const key = `${gene.type}:${gene.name}`;
        const existing = freqMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          freqMap.set(key, { type: gene.type, count: 1 });
        }
      }
    }

    const frequentEntities = [...freqMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([key, val]) => {
        const [type, name] = key.split(':');
        return { name, type, mentionCount: val.count };
      });

    const sorted = [...dnas].sort((a, b) => a.seq_pos - b.seq_pos);

    return {
      timeline,
      frequentEntities,
      timeSpan: {
        earliest: sorted[0]?.created_at ?? '',
        latest: sorted[sorted.length - 1]?.created_at ?? '',
      },
    };
  }

}
