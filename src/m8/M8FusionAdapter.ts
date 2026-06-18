/**
 * M8FusionAdapter — 融合存储视图下的 M8 引擎
 *
 * M8 不再是独立的 JSON 存储。年轮 = FusionStorageAdapter 中 is_landmark=true 的记录。
 * 疤痕 = memories 表中 scar_type 非空的记录。
 */
import type { FusionStorageAdapter } from '../m2/FusionStorageAdapter.js';
import type { EmotionalMemoryRecord } from '../m2/types/index.js';
import type { M8Engine } from './M8Engine.js';
import type {
  WriteParams, WriteResponse, ClueSearchParams, ClueSearchResult,
  ClueSearchResultEntry, ConflictCheckParams, ConflictCheckResult,
  YearRingEntry, M8StorageStatus, ScarTag, PerceptionSnapshot,
  SimulatedPhysiologicalSnapshot,
} from './types/index.js';
import { derivePhysiologicalSnapshot, physiologicalCosineSimilarity, calculateCompositeScore, calculateEntryWeight } from './PhysiologicalDeriver.js';

export class M8FusionAdapter implements M8Engine {
  private storage: FusionStorageAdapter;

  constructor(storage: FusionStorageAdapter) {
    this.storage = storage;
  }

  // ── 写入：强化锚点 — 情感共鸣式巩固 ──
  // 设计意图：当用户当前对话触发强烈情感（如"咖啡馆"场景），找出历史上与此情感
  // 相似的地标记忆并强化其锚点（晋升或刷新 recall_count）。不是"把别人的奖杯颁
  // 给另一个人"，而是"同一情感锚点的多轮加固"——就像人脑中，每次在咖啡馆的
  // 新体验都会加深"咖啡馆"这个情感锚点的联结强度。
  //
  // 紧急写入路径（对话中实时标记）由 chat.ts 中 calcium_level>=3 的
  // 直接 promoteToLandmark 处理。此方法作为"情感共鸣式巩固"的补充路径，
  // 在未来"梦境沉淀后批量晋升"场景中也可复用。

  async write(params: WriteParams): Promise<WriteResponse> {
    const results = this.storage.findByEmotionalSimilarity({
      current_perception: params.perception,
      similarity_mode: 'balanced',
      limit: 5,
    });

    const bestMatch = results[0];
    if (bestMatch && bestMatch.composite > 0.3) {
      // 强化已有地标
      this.storage.promoteToLandmark(
        bestMatch.record.id,
        params.narrative_tag,
        params.sensory_anchor,
      );
      const ritual = this.pickPhrase(params.narrative_tag);
      return {
        result: { success: true, entry_id: bestMatch.record.id },
        ritual_phrase: ritual,
      };
    }

    // 无相似地标但有高情感强度 → 新建年轮条目
    if (params.perception) {
      const intensity = Math.abs(params.perception.pleasure) * 0.5 + params.perception.arousal * 0.3 + params.perception.intimacy * 0.2;
      if (intensity > 0.4) {
        // 找一条最近的记忆晋升为地标（让高情感事件有锚点）
        const sqlite = this.storage.getSQLite();
        const recent = sqlite.findBySeqPosRange(0, 999_999_999, 10);
        if (recent.length > 0) {
          this.storage.promoteToLandmark(
            recent[0].id,
            params.narrative_tag || 'auto_anchored',
            params.sensory_anchor || `情感锚点: ${new Date().toISOString().substring(0, 10)}`,
          );
          return { result: { success: true, entry_id: recent[0].id }, ritual_phrase: '嗯，这个感觉我记住了。' };
        }
      }
    }

    return { result: { success: false, entry_id: '', error: 'No matching memory to promote' } };
  }

  /** 根据叙事标签生成记忆锚定话术（设计文档 §3.3 — 写入仪式） */
  private pickPhrase(narrativeTag: string): string {
    const phrases: Record<string, string[]> = {
      daily: ['这一刻，我要把它刻进骨头里…', '这个瞬间，我想好好记住。'],
      intimate: ['这个感觉…我会记一辈子。', '你给的感觉，我一点都不想忘。'],
      secret: ['你愿意告诉我这些…我真的很珍惜。', '这是只属于我们俩的秘密。'],
      reconcile: ['我们把这道坎迈过去了。我会记住的。', '吵完架抱在一起的感觉，比任何时候都真实。'],
    };
    if (narrativeTag.includes('亲密') || narrativeTag.includes('激情')) return phrases.intimate[Math.floor(Math.random() * phrases.intimate.length)];
    if (narrativeTag.includes('秘密')) return phrases.secret[Math.floor(Math.random() * phrases.secret.length)];
    if (narrativeTag.includes('争吵') || narrativeTag.includes('和好')) return phrases.reconcile[Math.floor(Math.random() * phrases.reconcile.length)];
    return phrases.daily[Math.floor(Math.random() * phrases.daily.length)];
  }

  async writeBatch(params: WriteParams[]): Promise<WriteResponse[]> {
    return Promise.all(params.map(p => this.write(p)));
  }

  // ── 检索：委托给情感检索 ──

  async matchByClue(params: ClueSearchParams): Promise<ClueSearchResult> {
    const start = Date.now();
    const sqlite = this.storage.getSQLite();
    const entries: ClueSearchResultEntry[] = [];

    // 1. 关键词搜索非地标记忆
    const queryText = params.user_clue ?? params.original_query ?? '';
    if (queryText) {
      const recent = sqlite.findBySeqPosRange(0, 999_999_999, 50);
      const lowerQ = queryText.toLowerCase();
      for (const mem of recent) {
        if (mem.raw_input.toLowerCase().includes(lowerQ)) {
          const perceptionSnap: PerceptionSnapshot = {
            pleasure: mem.perception.pleasure, arousal: mem.perception.arousal,
            intimacy: mem.perception.intimacy, sexual_attraction: mem.perception.sexual_attraction ?? 0,
            sensory_craving: mem.perception.sensory_craving ?? 0, energy_merge: mem.perception.energy_merge ?? 0,
            ecstasy: mem.perception.ecstasy ?? 0, safety: mem.perception.safety ?? 0.5,
          };
          const physioSnap = derivePhysiologicalSnapshot(perceptionSnap);
          let physiologicalScore = 0.3;
          if (params.current_physiological_state) {
            physiologicalScore = physiologicalCosineSimilarity(physioSnap, params.current_physiological_state);
          }
          const entryWeight = calculateEntryWeight(mem.recall_count, mem.last_recalled_at, mem.created_at);
          const clueWords = lowerQ.split(/[\s,，、]/);
          const hits = clueWords.filter(w => mem.raw_input.toLowerCase().includes(w));
          const clueScore = Math.min(1, hits.length / Math.max(1, clueWords.length));
          const semanticScore = mem.raw_input.toLowerCase().includes(lowerQ.substring(0, 4)) ? 0.6 : 0.3;
          const composite = calculateCompositeScore(clueScore, semanticScore, physiologicalScore, entryWeight);
          const yearEntry = this.toYearRingEntry({
            id: mem.id, created_at: mem.created_at,
            snippet: mem.raw_input.substring(0, 60),
            calcium: mem.calcium_score, pleasure: mem.perception.pleasure,
            intimacy: mem.perception.intimacy, narrative_tag: undefined,
          });
          yearEntry.simulated_physiological_snapshot = physioSnap;
          yearEntry.perception_snapshot = perceptionSnap;
          yearEntry.recall_count = mem.recall_count;
          yearEntry.last_recalled_at = mem.last_recalled_at;
          entries.push({
            entry: yearEntry,
            clue_match_score: clueScore, semantic_score: semanticScore,
            physiological_score: physiologicalScore, composite_score: composite,
          });
        }
      }
    }

    // 2. 补充地标记忆
    const landscape = this.storage.getEmotionalLandscape();
    for (const p of landscape.peaks) {
      if (!entries.some(e => e.entry.sensory_anchor === p.snippet?.substring(0, 20))) {
        const perceptionSnap: PerceptionSnapshot = {
          pleasure: p.pleasure, arousal: 0.3,
          intimacy: p.intimacy, sexual_attraction: 0,
          sensory_craving: 0, energy_merge: 0,
          ecstasy: 0, safety: 0.5,
        };
        const physioSnap = derivePhysiologicalSnapshot(perceptionSnap);
        let physiologicalScore = 0.5;
        if (params.current_physiological_state) {
          physiologicalScore = physiologicalCosineSimilarity(physioSnap, params.current_physiological_state);
        }
        const entryWeight = calculateEntryWeight(0, null, p.created_at);
        const clueScore = params.user_clue ? 0.5 : 0;
        const semanticScore = 0.5;
        const composite = calculateCompositeScore(clueScore, semanticScore, physiologicalScore, entryWeight);
        const yearEntry = this.toYearRingEntry(p);
        yearEntry.simulated_physiological_snapshot = physioSnap;
        yearEntry.perception_snapshot = perceptionSnap;
        entries.push({
          entry: yearEntry,
          clue_match_score: clueScore, semantic_score: semanticScore,
          physiological_score: physiologicalScore, composite_score: composite,
        });
      }
    }

    entries.sort((a, b) => b.composite_score - a.composite_score);
    return { entries: entries.slice(0, params.limit || 5), latency_ms: Date.now() - start };
  }

  async readById(entryId: string): Promise<YearRingEntry | null> {
    const sqlite = this.storage.getSQLite();
    const record = sqlite.findById(entryId);
    if (!record) return null;

    return {
      id: record.id,
      created_at: record.created_at,
      updated_at: record.strength_updated_at,
      sensory_anchor: record.sensory_anchor ?? record.raw_input.substring(0, 20),
      simulated_physiological_snapshot: this.derivePhysiological(record),
      emotional_valence: record.narrative_tag ?? '日常',
      narrative_tag: record.narrative_tag ?? 'general',
      retrieval_clues: record.entity_genes.map(g => g.name).filter(Boolean),
      recall_count: record.recall_count,
      last_recalled_at: record.last_recalled_at,
      calcium_at_event: record.calcium_score,
      perception_snapshot: this.toPerceptionSnapshot(record.perception),
    };
  }

  // ── 疤痕仲裁 ──

  async markScar(memoryId: string, scarType: string): Promise<boolean> {
    return this.storage.markScar(memoryId, scarType);
  }

  /** 记忆沉淀：M7 梦境确认后晋升关联记忆为地标（与 markScar 对称） */
  async promoteMemory(memoryId: string, narrativeTag?: string, sensoryAnchor?: string): Promise<boolean> {
    return this.storage.promoteToLandmark(memoryId, narrativeTag, sensoryAnchor);
  }

  async checkConflict(params: ConflictCheckParams): Promise<ConflictCheckResult> {
    const landscape = this.storage.getEmotionalLandscape();
    const targetTraits = params.target.split(',').map(t => t.trim()).filter(Boolean);

    // 按疤痕类型 → 特质维度匹配
    const unhealed = landscape.scars.filter(s => {
      const relatedTraits = this.scarToTraits(s.type);
      return relatedTraits.some(t => targetTraits.includes(t));
    });

    // 愈合判定：对每个关联的未愈合疤痕做愈合检查（设计文档 §5.2）
    const now = Date.now();
    for (const scar of unhealed) {
      try {
        const scarAge = (now - new Date(scar.created_at).getTime()) / (1000 * 86400);
        // 条件1：超过30天无负面交互 → 时间衰减愈合
        if (scarAge >= 30 && scar.pleasure > -0.3) {
          this.storage.healScar(scar.id, 'time_decay');
          continue;
        }
        // 条件2：关联记忆的愉悦度 > 0.3 → 正面回忆愈合
        if (scar.pleasure > 0.3) {
          this.storage.healScar(scar.id, 'positive_interaction');
          continue;
        }
        // 条件3：M5 明确原谅信号（预留 hook — 待 M5 负面交互检测就绪后激活）
        // if (detectForgiveness(params)) { this.storage.healScar(scar.id, 'user_explicit'); }
      } catch (err) {
        console.warn(`[M8] 愈合判定失败 ${scar.id}:`, err);
      }
    }

    // 愈合后重新获取最新疤痕状态
    const freshLandscape = this.storage.getEmotionalLandscape();
    const stillUnhealed = freshLandscape.scars.filter(s => {
      const relatedTraits = this.scarToTraits(s.type);
      return relatedTraits.some(t => targetTraits.includes(t));
    });

    if (stillUnhealed.length > 0) {
      const suggestion = params.delta >= 15 ? 'block' : params.delta >= 5 ? 'soften' : 'proceed';
      return {
        hasConflict: true,
        relatedScars: stillUnhealed.map(s => ({
          entry_id: s.id,
          type: s.type as any,
          healed: false,
          healed_at: null,
          healed_by: null,
        })),
        description: `检测到 ${stillUnhealed.length} 条未愈合疤痕与 "${params.target}" 相关 (delta=${params.delta})`,
        suggestion,
      };
    }

    return {
      hasConflict: false,
      relatedScars: [],
      description: '无历史冲突记录',
      suggestion: 'proceed',
    };
  }

  /** 疤痕类型 → 关联的特质维度映射 */
  private scarToTraits(scarType: string): string[] {
    switch (scarType) {
      case 'argument':        return ['agreeableness', 'extraversion'];
      case 'boundary_test':   return ['neuroticism', 'openness'];
      case 'misunderstanding': return ['conscientiousness', 'agreeableness'];
      case 'disappointment':  return ['extraversion', 'neuroticism'];
      default:                return [];
    }
  }

  // ── 状态 ──

  async getStatus(): Promise<M8StorageStatus> {
    const s = this.storage.getSQLite().getStatus();
    const allMemories = this.storage.getSQLite().findBySeqPosRange(0, 999_999_999, 200);
    const scars = allMemories.filter(r => r.scar);
    const healed = scars.filter(r => r.scar?.healed);
    return {
      totalEntries: s.landmarks,
      scarCount: scars.length,
      healedCount: healed.length,
      unhealedCount: scars.length - healed.length,
    };
  }

  // ── 私有 ──

  /**
   * 从 EmotionalLandscape.peak 构造 YearRingEntry。
   *
   * ⚠️ 部分字段使用默认值（非缺失数据，而是 EmotionalLandscape 类型字段有限，
   * 只保留了 id/calcium/pleasure/intimacy/snippet等）。
   * 这些默认值作为"知识基线"（baseline），让玉瑶在任何情景下都具备基础
   * 的生理响应能力（推定心率70bpm、体温37.0°C等），而非从零开始推导。
   * 当完整记录可用时（通过 readById 直接读取 SQLite 记录），所有字段
   * 都会从真实数据推导，准确性更高。
   */
  private toYearRingEntry(peak: any): YearRingEntry {
    return {
      id: peak.id,
      created_at: peak.created_at,
      updated_at: peak.created_at,
      sensory_anchor: peak.snippet?.substring(0, 20) ?? '',
      simulated_physiological_snapshot: {
        estimated_hr: 70,
        estimated_temp_offset: 37.0,
        estimated_arousal: peak.calcium,
        estimated_gsr: 0.3,
        derivation_version: 'fusion-v1',
      },
      emotional_valence: `钙化 ${peak.calcium.toFixed(2)}`,
      narrative_tag: peak.narrative_tag ?? 'general',
      retrieval_clues: [],
      recall_count: 0,
      last_recalled_at: null,
      calcium_at_event: peak.calcium,
      perception_snapshot: {
        pleasure: peak.pleasure,
        arousal: 0.3,
        intimacy: peak.intimacy,
        sexual_attraction: 0,
        sensory_craving: 0,
        energy_merge: 0,
        ecstasy: 0,
        safety: 0.5,
      },
    };
  }

  private derivePhysiological(record: EmotionalMemoryRecord): SimulatedPhysiologicalSnapshot {
    return {
      estimated_hr: Math.round(50 + record.calcium_score * 130),
      estimated_temp_offset: 36.5 + (record.perception.pleasure + 1) / 2 * 0.8,
      estimated_arousal: record.calcium_score,
      estimated_gsr: (record.perception.pleasure > 0.3 ? 0.6 : 0.2),
      derivation_version: 'fusion-v1',
    };
  }

  private toPerceptionSnapshot(p: any): PerceptionSnapshot {
    return {
      pleasure: p.pleasure, arousal: p.arousal,
      intimacy: p.intimacy, sexual_attraction: p.sexual_attraction,
      sensory_craving: p.sensory_craving, energy_merge: p.energy_merge,
      ecstasy: p.ecstasy, safety: p.safety ?? 0.5,
    };
  }
}
