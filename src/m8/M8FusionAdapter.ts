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

export class M8FusionAdapter implements M8Engine {
  private storage: FusionStorageAdapter;

  constructor(storage: FusionStorageAdapter) {
    this.storage = storage;
  }

  // ── 写入：晋升一条记忆为地标 ──

  async write(params: WriteParams): Promise<WriteResponse> {
    // 通过情感检索找到最匹配的记忆，标记为地标
    const results = this.storage.findByEmotionalSimilarity({
      current_perception: params.perception,
      similarity_mode: 'balanced',
      limit: 5,
    });

    const bestMatch = results[0];
    if (bestMatch && bestMatch.composite > 0.3) {
      this.storage.promoteToLandmark(
        bestMatch.record.id,
        params.narrative_tag,
        params.sensory_anchor,
      );
      return {
        result: { success: true, entry_id: bestMatch.record.id },
      };
    }

    return { result: { success: false, entry_id: '', error: 'No matching memory to promote' } };
  }

  async writeBatch(params: WriteParams[]): Promise<WriteResponse[]> {
    return Promise.all(params.map(p => this.write(p)));
  }

  // ── 检索：委托给情感检索 ──

  async matchByClue(params: ClueSearchParams): Promise<ClueSearchResult> {
    const start = Date.now();
    const sqlite = this.storage.getSQLite();
    const entries: ClueSearchResultEntry[] = [];

    // 1. 关键词搜索非地标记忆（地标可能为空）
    const queryText = params.user_clue ?? params.original_query ?? '';
    if (queryText) {
      const recent = sqlite.findBySeqPosRange(0, 999_999_999, 50);
      const lowerQ = queryText.toLowerCase();
      for (const mem of recent) {
        if (mem.raw_input.toLowerCase().includes(lowerQ)) {
          entries.push({
            entry: this.toYearRingEntry({
              id: mem.id, created_at: mem.created_at,
              snippet: mem.raw_input.substring(0, 60),
              calcium: mem.calcium_score, pleasure: mem.perception.pleasure,
              intimacy: mem.perception.intimacy, narrative_tag: undefined,
            }),
            clue_match_score: 0.8, semantic_score: 0.5,
            physiological_score: 0.3, composite_score: mem.calcium_score,
          });
        }
      }
    }

    // 2. 补充地标记忆
    const landscape = this.storage.getEmotionalLandscape();
    for (const p of landscape.peaks) {
      if (!entries.some(e => e.entry.sensory_anchor === p.snippet?.substring(0, 20))) {
        entries.push({
          entry: this.toYearRingEntry(p), clue_match_score: 0.5,
          semantic_score: 0.5, physiological_score: 0.5, composite_score: p.calcium,
        });
      }
    }

    entries.sort((a, b) => b.composite_score - a.composite_score);
    return { entries: entries.slice(0, params.limit || 5), latency_ms: Date.now() - start };
  }

  async readById(entryId: string): Promise<YearRingEntry | null> {
    const sqlite = this.storage.getSQLite();
    const record = sqlite.findById(entryId);
    if (!record || !record.is_landmark) return null;

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

  async checkConflict(params: ConflictCheckParams): Promise<ConflictCheckResult> {
    const landscape = this.storage.getEmotionalLandscape();
    const targetTraits = params.target.split(',').map(t => t.trim()).filter(Boolean);

    // 按疤痕类型 → 特质维度匹配，而非 narrative_tag
    const unhealed = landscape.scars.filter(s => {
      const relatedTraits = this.scarToTraits(s.type);
      return relatedTraits.some(t => targetTraits.includes(t));
    });

    if (unhealed.length > 0) {
      // delta 决定严重度：≥15=block, ≥5=soften, <5=proceed
      const suggestion: 'block' | 'soften' | 'proceed' =
        params.delta >= 15 ? 'block' :
        params.delta >= 5  ? 'soften' :
        'proceed';

      return {
        hasConflict: true,
        relatedScars: unhealed.map(s => ({
          entry_id: s.id,
          type: s.type as any,
          healed: false,
          healed_at: null,
          healed_by: null,
        })),
        description: `检测到 ${unhealed.length} 条未愈合疤痕与 "${params.target}" 相关 (delta=${params.delta})`,
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
    const landscape = this.storage.getEmotionalLandscape();
    return {
      totalEntries: s.landmarks,
      scarCount: landscape.scars.length,
      healedCount: 0,
      unhealedCount: landscape.scars.length,
    };
  }

  // ── 私有 ──

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
