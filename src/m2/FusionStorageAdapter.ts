/**
 * FusionStorageAdapter — 统一存储适配器
 *
 * 双写策略：SQLite（主存储，检索/排序/计算） + JSON Zone（人类可读备份）
 * 读取时优先走 SQLite。
 *
 * 取代旧的 JsonStorageAdapter。
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DNA, LeafZone } from '../m1/types/dna.js';
import type { Perception24D } from '../m3/types/perception.js';
import type { WriteResult, ReadResult, QueryOptions, StorageStatus } from './types/index.js';
import { SQLiteAdapter } from './SQLiteAdapter.js';
import { computeCalcium, initialStrength } from './math.js';
import type { EmotionalMemoryRecord, RetrievalQuery, ScoredMemory, EmotionalLandscape } from './types/index.js';
import { FAMILY_GRAPH_MIGRATION } from '../config/family-graph-migration.js';
import { ConversationDB } from './ConversationDB.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');

export class FusionStorageAdapter {
  private sqlite: SQLiteAdapter;
  private dataDir: string;
  private seqCounter = 0;
  private initialized = false;
  /** 家族图谱主库引用（双库统一用） */
  private familyGraph: any | null = null;
  /** 共享 ConversationDB 实例（三段存储③砂金库） */
  private _conversationDB: any = null;
  /** P10: JSON Zone 备份开关（默认开启保持兼容，生产环境可关闭减少IO） */
  private enableJsonZone: boolean;

  constructor(dataDir?: string, options?: { enableJsonZone?: boolean }) {
    this.dataDir = dataDir ?? join(PROJECT_ROOT, 'data', 'webui');
    this.enableJsonZone = options?.enableJsonZone ?? true;
    this.sqlite = new SQLiteAdapter(join(this.dataDir, 'fusion_memory.db'));
  }

  async initialize(): Promise<void> {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
    await this.sqlite.initialize();
    // 初始化共享 ConversationDB（使用同一个 sql.js 实例）
    this._conversationDB = new ConversationDB(undefined, this.sqlite.getDb());
    await this._conversationDB.initialize();
    this.seqCounter = this.sqlite.getTotalCount();
    this.initialized = true;
  }

  // ─── 写入（接收 DNA + 24D 感知向量） ───

  /** 预分配下一个 seq_pos（不写入，由 WorkingMemory 负责实际写入） */
  reserveNextSeq(): number {
    this.ensureReady();
    this.seqCounter++;
    return this.seqCounter;
  }

  async write(dna: DNA, perception: Perception24D, primaryEmotion?: string, secondaryEmotions?: string[]): Promise<WriteResult> {
    this.ensureReady();
    // 优先用 dna.seq_pos（预分配），否则自增
    const pos = dna.seq_pos > 0 ? dna.seq_pos : (this.seqCounter + 1);
    if (dna.seq_pos <= 0) this.seqCounter++;
    else this.seqCounter = Math.max(this.seqCounter, dna.seq_pos);

    const calcium = computeCalcium(perception);
    const now = new Date().toISOString();
    const strength = initialStrength(calcium.score);

    const record: EmotionalMemoryRecord = {
      id: dna.branch_id,
      seq_pos: pos,
      created_at: now,
      dna_root_id: (dna as any).dna_root_id,  // 三段关联主键
      perception,
      calcium_score: calcium.score,
      calcium_level: calcium.level,
      raw_input: dna.raw_input,
      locus_path: dna.locus_path,
      entity_genes: dna.entity_genes,
      leaf_zone: dna.leaf_zone,
      primary_emotion: primaryEmotion,
      secondary_emotions: secondaryEmotions,
      recall_count: 0,
      last_recalled_at: null,
      reinforcement_accumulator: 0,
      effective_strength: strength,
      strength_updated_at: now,
      is_landmark: false,
      landmarked_at: null,
    };

    // SQLite 写入（主存储）
    this.sqlite.write(record);

    // JSON Zone 写入（备份）— P10: 可关闭
    if (this.enableJsonZone) {
      this.appendToJsonZone(dna, perception);
    }

    return {
      success: true,
      real_ref: `seq_${String(pos).padStart(6, '0')}`,
      seq_pos: pos,
    };
  }

  // ─── 读取兼容接口 ───

  async read(branchId: string): Promise<ReadResult> {
    this.ensureReady();
    const record = this.sqlite.findById(branchId);
    if (!record) return { dna: null };
    return { dna: this.toDNA(record) };
  }

  async findByLocus(locusPath: string, options?: QueryOptions): Promise<DNA[]> {
    this.ensureReady();
    // 默认过滤低强度记忆（strength < 0.05 的不返回）
    const records = this.sqlite.findByLocusWithStrength(locusPath, options?.limit ?? 20, 0.05);
    return records.map(r => this.toDNA(r));
  }

  async findBySeqPosRange(start: number, end: number, options?: QueryOptions): Promise<DNA[]> {
    this.ensureReady();
    // 默认衰减门控：strength < 0.05 的不返回，按 (strength * calcium) 排序
    const records = this.sqlite.findBySeqPosRangeWithStrength(start, end, options?.limit ?? 50, 0.05);
    return records.map(r => this.toDNA(r));
  }

  /** 带衰减门控的范围检索 */
  async findBySeqPosRangeFiltered(start: number, end: number, options?: QueryOptions & { minStrength?: number }): Promise<DNA[]> {
    this.ensureReady();
    const records = this.sqlite.findBySeqPosRangeWithStrength(start, end, options?.limit ?? 50, options?.minStrength ?? 0.05);
    return records.map(r => this.toDNA(r));
  }

  /** 带衰减门控的话题检索 */
  async findByLocusFiltered(locusPath: string, options?: QueryOptions & { minStrength?: number }): Promise<DNA[]> {
    this.ensureReady();
    const records = this.sqlite.findByLocusWithStrength(locusPath, options?.limit ?? 20, options?.minStrength ?? 0.05);
    return records.map(r => this.toDNA(r));
  }

  /** 获取衰减日志摘要 */
  getDecayStats(): { avgStrength: number; strongCount: number; weakCount: number } {
    const all = this.sqlite.findBySeqPosRange(0, 999_999_999, 200);
    if (all.length === 0) return { avgStrength: 0, strongCount: 0, weakCount: 0 };
    const avg = all.reduce((s, r) => s + r.effective_strength, 0) / all.length;
    return {
      avgStrength: Math.round(avg * 100) / 100,
      strongCount: all.filter(r => r.effective_strength > 0.5).length,
      weakCount: all.filter(r => r.effective_strength < 0.1).length,
    };
  }

  // ─── 新增：情感检索 ───

  findByEmotionalSimilarity(query: RetrievalQuery): ScoredMemory[] {
    this.ensureReady();
    return this.sqlite.findByEmotionalSimilarity(query);
  }

  updateRecall(memoryIds: string[]): void {
    this.ensureReady();
    this.sqlite.updateRecall(memoryIds);
  }

  applyReinforcement(perception: Perception24D, calcium: number, memoryIds: string[]): void {
    this.ensureReady();
    this.sqlite.applyReinforcement(perception, calcium, memoryIds);
  }

  getEmotionalLandscape(): EmotionalLandscape {
    this.ensureReady();
    return this.sqlite.getEmotionalLandscape();
  }

  promoteToLandmark(memoryId: string, narrativeTag?: string, sensoryAnchor?: string): boolean {
    this.ensureReady();
    return this.sqlite.promoteToLandmark(memoryId, narrativeTag, sensoryAnchor);
  }

  markScar(memoryId: string, scarType: string): boolean {
    this.ensureReady();
    const record = this.sqlite.findById(memoryId);
    if (!record || record.is_landmark) return false;
    record.scar = { type: scarType as any, healed: false, healed_at: null };
    this.sqlite.write(record);
    return true;
  }

  /** 愈合疤痕（用户原谅/时间衰减/正面回忆 → 标记愈合） */
  healScar(memoryId: string, healedBy: string): boolean {
    this.ensureReady();
    const record = this.sqlite.findById(memoryId);
    if (!record || !record.scar) return false;
    record.scar.healed = true;
    record.scar.healed_at = new Date().toISOString();
    this.sqlite.write(record);
    return true;
  }

  /** 更新已存在记忆的 VAD 谱曲 */
  updateVadSpectrum(memoryId: string, vad: any): boolean {
    this.ensureReady();
    return this.sqlite.updateVadSpectrum(memoryId, vad);
  }

  /** 实体重叠 → 关联知识检索 */
  findKnowledgeByEntityOverlap(entityNames: string[], limit = 5) {
    this.ensureReady();
    return this.sqlite.findKnowledgeByEntityOverlap(entityNames, limit);
  }

  runDecayMaintenance(): { total: number; archived: number } {
    this.ensureReady();
    return this.sqlite.runDecayMaintenance();
  }

  // ─── 实体关系检索（双库统一路由） ───

  /**
   * 查找关联实体（双库统一路由）
   * - shadow 模式：仅从 entity_relations（影子库）读取
   * - compat 模式：影子库 + FamilyGraph 合并
   * - main 模式：先查 FamilyGraph，不足时回退影子库
   */
  findRelatedEntities(entityNames: string[], minStrength = 0.3) {
    const oldResult = this.sqlite.findRelatedEntities(entityNames, minStrength);

    if (this.familyGraph && FAMILY_GRAPH_MIGRATION.readMode !== 'shadow') {
      try {
        const fgResult = this.familyGraph.getRelatedPersonsBatch(entityNames, minStrength);
        if (fgResult.length > 0) {
          // 合并：FamilyGraph 数据优先（覆盖同名条目），其余用影子库补足
          const fgNames = new Set(fgResult.map((r: any) => r.name));
          const merged = [...fgResult, ...oldResult.filter((r: any) => !fgNames.has(r.name))];
          return merged;
        }
      } catch (e) {
        console.warn('[FG-Mig] FamilyGraph 读取失败，回退影子库:', (e as Error).message);
      }
    }

    return oldResult;
  }

  /**
   * N跳关联实体检索（双库统一路由）
   */
  findRelatedEntitiesN(entityNames: string[], maxHops: 1|2|3 = 1, minStrength = 0.3, maxAgeDays?: number) {
    const oldResult = this.sqlite.findRelatedEntitiesN(entityNames, maxHops, minStrength, maxAgeDays);

    if (this.familyGraph && FAMILY_GRAPH_MIGRATION.readMode !== 'shadow') {
      try {
        const fgResult = this.familyGraph.getRelatedPersonsN(entityNames, maxHops, minStrength);
        if (fgResult.length > 0) {
          const fgNames = new Set(fgResult.map((r: any) => r.name));
          const merged = [...fgResult, ...oldResult.filter((r: any) => !fgNames.has(r.name))];
          return merged.sort((a: any, b: any) => (b.strength || 0) - (a.strength || 0)).slice(0, 15);
        }
      } catch (e) {
        console.warn('[FG-Mig] FamilyGraph N跳读取失败:', (e as Error).message);
      }
    }

    return oldResult;
  }

  findMemoriesByEntityNames(entityNames: string[], limit = 10) {
    return this.sqlite.findMemoriesByEntityNames(entityNames, limit);
  }

  /**
   * 实体关系摘要（双库合并）
   */
  getEntityRelationSummary() {
    const oldResult = this.sqlite.getEntityRelationSummary();

    if (this.familyGraph && FAMILY_GRAPH_MIGRATION.readMode !== 'shadow') {
      try {
        const fgSummary = this.familyGraph.getAllEdgesSummary();
        if (fgSummary.length > 0) {
          return [...fgSummary, ...oldResult];
        }
      } catch (e) {
        console.warn('[FG-Mig] FamilyGraph 摘要读取失败:', (e as Error).message);
      }
    }

    return oldResult;
  }

  // ─── 状态 ───

  async getStatus(): Promise<StorageStatus> {
    this.ensureReady();
    const status = this.sqlite.getStatus();
    return {
      totalRecords: status.totalRecords,
      zoneCounts: {},
      currentSeqPos: this.seqCounter,
      storagePath: this.dataDir,
    };
  }

  async nextSeqPos(): Promise<number> {
    this.seqCounter++;
    return this.seqCounter;
  }

  /**
   * 设置家族图谱实例（双库统一读取路由）
   */
  setFamilyGraph(fg: any): void {
    this.familyGraph = fg;
  }

  getFamilyGraph(): any | null {
    return this.familyGraph;
  }

  // ─── SQLite 直通 ───

  getSQLite(): SQLiteAdapter {
    return this.sqlite;
  }

  /** 获取共享的 ConversationDB 实例（三段存储③砂金库） */
  getConversationDB(): any {
    return this._conversationDB;
  }

  // ─── 私有方法 ───

  private ensureReady(): void {
    if (!this.initialized) throw new Error('FusionStorageAdapter not initialized');
  }

  private toDNA(record: EmotionalMemoryRecord): DNA {
    return {
      branch_id: record.id,
      seq_pos: record.seq_pos,
      locus_path: record.locus_path,
      taxonomy_version: '1.0',
      leaf_zone: record.leaf_zone as LeafZone,
      ref: `seq_${String(record.seq_pos).padStart(6, '0')}`,
      entity_genes: record.entity_genes,
      raw_input: record.raw_input,
      created_at: record.created_at,
      calcium_score: record.calcium_score,
      calcium_level: record.calcium_level,
    };
  }

  /**
   * Zone JSON 备份写入
   * 保持与旧 JsonStorageAdapter 兼容的格式
   */
  private appendToJsonZone(dna: DNA, perception: Perception24D): void {
    try {
      const zone = dna.leaf_zone || 'language_semantic_zone';
      const zoneDir = join(this.dataDir, 'zones');
      if (!existsSync(zoneDir)) mkdirSync(zoneDir, { recursive: true });

      const filePath = join(zoneDir, `${zone}.json`);
      let data: any[] = [];
      if (existsSync(filePath)) {
        try { data = JSON.parse(readFileSync(filePath, 'utf-8')); } catch (err) { console.warn("[Fusion] Zone解析失败:", err); data = []; }
      }

      data.push({
        position: data.length,
        seq_pos: this.seqCounter,
        dna: { ...dna, leaf_zone: undefined },
        written_at: new Date().toISOString(),
        perception_preview: {
          calcium_score: computeCalcium(perception).score,
          pleasure: perception.pleasure,
          arousal: perception.arousal,
          intimacy: perception.intimacy,
        },
      });

      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[FusionStorageAdapter] Zone backup write failed:', err);
    }
  }
}
