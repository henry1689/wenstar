// MemoryRetriever — 从 M2 检索历史记忆 + 上下文压缩
// Ref: M4-design-v1.md §4

import type { FusionStorageAdapter } from '../m2/FusionStorageAdapter.js';
import type { DNA } from '../m1/types/dna.js';
import type { MemorySummary, M4Context } from './types/index.js';
import type { M3Action, M3Decision } from '../m3/types/perception.js';

export class MemoryRetriever {
  private storage: FusionStorageAdapter;

  constructor(storage: FusionStorageAdapter) {
    this.storage = storage;
  }

  /**
   * 根据 M3 决策检索相关历史记忆
   *
   * 检索策略（按优先级）：
   * 1. 按 locus_path 话题前缀检索 — 分类树路由匹配
   * 2. 按实体名称 + 原始输入关键词全文搜索 — 真正的内容匹配
   */
  async retrieveMemories(
    locusPath: string,
    entities: Array<{ name: string; type: string }>,
    options?: { limit?: number; minCalcium?: number }
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
        // 检索最近 60 条记录（含各分区）
        const recent = await this.storage.findBySeqPosRange(0, 999_999_999, {
          limit: 60,
          ascending: false,
        });
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
      } catch (err) {
        console.warn("[M4] 检索失败:", err);
        // 静默失败
      }
    }

    // 3. 合并去重（byKeyword 优先于 byLocus，因为全文匹配更精准）
    const seen = new Set<string>();
    const merged: DNA[] = [];
    for (const dna of [...byKeyword, ...byLocus]) {
      if (!seen.has(dna.branch_id) && merged.length < limit) {
        seen.add(dna.branch_id);
        merged.push(dna);
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

  /**
   * 构建 M4Context
   */
  async buildContext(
    decision: M3Decision,
    locusPath: string,
    entities: Array<{ name: string; type: string }>
  ): Promise<M4Context> {
    const memories = await this.retrieveMemories(locusPath, entities);
    const memorySummary = this.compressMemories(memories);

    return {
      decision,
      memory_summary: memorySummary,
      current_time: new Date().toISOString(),
      meta: {
        has_history: memories.length > 0,
        has_family_context: false,
        calcium_level: decision.enhanced.calcium_level,
        dominant_action: decision.actions[0] ?? 'memorize',
      },
    };
  }
}
