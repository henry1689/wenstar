/**
 * JsonYearRingAdapter — M8 JSON 文件存储实现（已废弃）
 *
 * @deprecated 由 M8FusionAdapter 完全取代。保留仅用于接口兼容参考。
 * Ref: docs/M8-design-v1.md §2.3, §4, §5
 */

import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { M8Engine } from './M8Engine.js';
import type {
  WriteParams, WriteResponse, ClueSearchParams, ClueSearchResult,
  ClueSearchResultEntry, ConflictCheckParams, ConflictCheckResult,
  YearRingEntry, M8StorageStatus, ScarTag, PerceptionSnapshot,
} from './types/index.js';
import { derivePhysiologicalSnapshot, physiologicalCosineSimilarity } from './PhysiologicalDeriver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', '..', 'data', 'year_rings');

const RITUAL_PHRASES: Record<string, string[]> = {
  daily: ['这一刻，我要把它刻进骨头里…', '这个瞬间，我想好好记住。'],
  intimate: ['这个感觉…我会记一辈子。', '你给的感觉，我一点都不想忘。'],
  secret: ['你愿意告诉我这些…我真的很珍惜。', '这是只属于我们俩的秘密。'],
  reconcile: ['我们把这道坎迈过去了。我会记住的。', '吵完架抱在一起的感觉，比任何时候都真实。'],
};

export class JsonYearRingAdapter implements M8Engine {
  private entries: YearRingEntry[] = [];
  private scars: ScarTag[] = [];
  private ringsPath: string;
  private invertedIndex: Map<string, string[]> = new Map();
  private scarsPath: string;

  constructor(dirPath?: string) {
    const base = dirPath ?? DATA_DIR;
    this.ringsPath = join(base, 'year_rings.json');
    this.scarsPath = join(base, 'scars.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.ringsPath)) this.entries = JSON.parse(fs.readFileSync(this.ringsPath, 'utf-8'));
      if (fs.existsSync(this.scarsPath)) this.scars = JSON.parse(fs.readFileSync(this.scarsPath, 'utf-8'));
    } catch (err) { console.warn("[M8-Json] 加载失败:", err); this.entries = []; this.scars = []; }
    this.buildIndex();
  }

  private buildIndex(): void {
    this.invertedIndex.clear();
    for (const entry of this.entries) {
      for (const clue of entry.retrieval_clues) {
        const key = clue.toLowerCase();
        if (!this.invertedIndex.has(key)) this.invertedIndex.set(key, []);
        this.invertedIndex.get(key)!.push(entry.id);
      }
    }
  }

  private save(): void {
    const dir = dirname(this.ringsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.ringsPath, JSON.stringify(this.entries, null, 2), 'utf-8');
    fs.writeFileSync(this.scarsPath, JSON.stringify(this.scars, null, 2), 'utf-8');
  }

  private pickPhrase(narrativeTag: string): string {
    if (narrativeTag.includes('亲密') || narrativeTag.includes('激情')) return RITUAL_PHRASES.intimate[Math.floor(Math.random() * RITUAL_PHRASES.intimate.length)];
    if (narrativeTag.includes('秘密')) return RITUAL_PHRASES.secret[Math.floor(Math.random() * RITUAL_PHRASES.secret.length)];
    if (narrativeTag.includes('争吵') || narrativeTag.includes('和好')) return RITUAL_PHRASES.reconcile[Math.floor(Math.random() * RITUAL_PHRASES.reconcile.length)];
    return RITUAL_PHRASES.daily[Math.floor(Math.random() * RITUAL_PHRASES.daily.length)];
  }

  private extractClues(rawInput: string): string[] {
    // 简单实体提取（MVP版）
    const tokens = rawInput.split(/[，。！？\s、：；]/);
    const clueSet = new Set<string>();
    for (const t of tokens) {
      const trimmed = t.trim();
      if (trimmed.length >= 2) clueSet.add(trimmed);
    }
    return [...clueSet].slice(0, 5);
  }

  // ── 写入 ──

  async write(params: WriteParams): Promise<WriteResponse> {
    const snapshot = derivePhysiologicalSnapshot({
      pleasure: params.perception.pleasure, arousal: params.perception.arousal,
      intimacy: params.perception.intimacy, sexual_attraction: params.perception.sexual_attraction,
      sensory_craving: params.perception.sensory_craving, energy_merge: params.perception.energy_merge,
      ecstasy: params.perception.ecstasy, safety: params.perception.safety || 0.5,
    });

    const perceptionSnapshot: PerceptionSnapshot = {
      pleasure: params.perception.pleasure, arousal: params.perception.arousal,
      intimacy: params.perception.intimacy, sexual_attraction: params.perception.sexual_attraction,
      sensory_craving: params.perception.sensory_craving, energy_merge: params.perception.energy_merge,
      ecstasy: params.perception.ecstasy, safety: params.perception.safety || 0.5,
    };

    const now = new Date().toISOString();
    const entryId = `yr_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

    const entry: YearRingEntry = {
      id: entryId, created_at: now, updated_at: now,
      sensory_anchor: params.sensory_anchor,
      simulated_physiological_snapshot: snapshot,
      emotional_valence: params.emotional_valence,
      narrative_tag: params.narrative_tag,
      retrieval_clues: this.extractClues(params.raw_input),
      recall_count: 0, last_recalled_at: null,
      calcium_at_event: params.calcium_at_event,
      perception_snapshot: perceptionSnapshot,
    };

    this.entries.push(entry);
    this.save();

    const ritual = this.pickPhrase(params.narrative_tag);
    return { result: { success: true, entry_id: entryId }, ritual_phrase: ritual };
  }

  async writeBatch(params: WriteParams[]): Promise<WriteResponse[]> {
    return Promise.all(params.map(p => this.write(p)));
  }

  // ── 检索 ──

  async matchByClue(params: ClueSearchParams): Promise<ClueSearchResult> {
    const start = Date.now();
    const results: ClueSearchResultEntry[] = [];

    for (const entry of this.entries) {
      let clueScore = 0;
      // 线索匹配
      if (params.user_clue) {
        const clueWords = params.user_clue.split(/[\s,，、]/);
        const hits = clueWords.filter(w => entry.retrieval_clues.some(c => c.includes(w)));
        clueScore = Math.min(1, hits.length / Math.max(1, clueWords.length));
      }

      // 如果没有 clue 但原始 query 匹配 sensory_anchor
      if (!params.user_clue && params.original_query) {
        clueScore = entry.sensory_anchor.includes(params.original_query) ? 0.5 : 0;
      }

      // 语义简化匹配
      const semanticScore = params.original_query && entry.sensory_anchor.includes(params.original_query.substring(0, 4)) ? 0.6 : 0.3;

      // 生理相似度
      let physiologicalScore = 0.3;
      if (params.current_physiological_state) {
        physiologicalScore = physiologicalCosineSimilarity(
          entry.simulated_physiological_snapshot,
          params.current_physiological_state,
        );
      }

      // 综合分数
      const composite = clueScore * 0.4 + semanticScore * 0.35 + physiologicalScore * 0.25;

      if (composite > 0) {
        results.push({ entry, clue_match_score: Math.round(clueScore * 1000) / 1000, semantic_score: Math.round(semanticScore * 1000) / 1000, physiological_score: Math.round(physiologicalScore * 1000) / 1000, composite_score: Math.round(composite * 1000) / 1000 });
      }
    }

    // 按综合分数降序排列
    results.sort((a, b) => b.composite_score - a.composite_score);
    const limit = params.limit || 5;
    const sliced = results.slice(0, limit);

    // 更新命中计数
    for (const r of sliced) {
      r.entry.recall_count++;
      r.entry.last_recalled_at = new Date().toISOString();
    }
    this.save();

    return {
      entries: sliced.map(r => ({
        entry: r.entry,
        clue_match_score: r.clue_match_score,
        semantic_score: r.semantic_score,
        physiological_score: r.physiological_score,
        composite_score: r.composite_score,
      })),
      latency_ms: Date.now() - start,
    };
  }

  async readById(entryId: string): Promise<YearRingEntry | null> {
    return this.entries.find(e => e.id === entryId) ?? null;
  }

  // ── 疤痕仲裁 ──

  async checkConflict(params: ConflictCheckParams): Promise<ConflictCheckResult> {
    const relatedScars = this.scars.filter(s => {
      // 查找与目标维度相关的未愈合疤痕
      const entry = this.entries.find(e => e.id === s.entry_id);
      if (!entry || s.healed) return false;
      return entry.narrative_tag.includes(params.target) || params.target.includes(entry.narrative_tag);
    });

    const unhealed = relatedScars.filter(s => !s.healed);

    if (unhealed.length > 0) {
      return {
        hasConflict: true,
        relatedScars: unhealed,
        description: `检测到 ${unhealed.length} 条未愈合疤痕与 "${params.target}" 相关`,
        suggestion: 'block',
      };
    }

    return {
      hasConflict: false,
      relatedScars: [],
      description: '无历史冲突记录',
      suggestion: 'proceed',
    };
  }

  // ── 维护 ──

  async getStatus(): Promise<M8StorageStatus> {
    return {
      totalEntries: this.entries.length,
      scarCount: this.scars.length,
      healedCount: this.scars.filter(s => s.healed).length,
      unhealedCount: this.scars.filter(s => !s.healed).length,
    };
  }

  /** 添加疤痕（测试和M7内化使用） */
  addScar(scar: ScarTag): void {
    this.scars.push(scar);
    this.save();
  }

  async markScar(_memoryId: string, _scarType: string): Promise<boolean> {
    return false;
  }

  /** 记忆沉淀（存根 — 已由 M8FusionAdapter 实现） */
  async promoteMemory(_memoryId: string, _narrativeTag?: string, _sensoryAnchor?: string): Promise<boolean> {
    return false;
  }

  /** 添加测试年轮条目 */
  addEntry(entry: YearRingEntry): void {
    this.entries.push(entry);
    this.save();
  }
}
