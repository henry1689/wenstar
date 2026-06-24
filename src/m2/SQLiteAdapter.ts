/**
 * SQLiteAdapter — SQLite 记忆存储封装
 *
 * 作为融合记忆系统的主存储引擎。
 * 使用 sql.js（纯 JS SQLite 实现，零原生依赖）。
 *
 * 遵循 `src/m4/FamilyGraph.ts` 中已建立的 sql.js 使用模式。
 */
// @ts-ignore - sql.js ships its own types
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Perception24D } from '../m3/types/perception.js';
import type { EntityGene } from '../m1/types/dna.js';
import type {
  EmotionalMemoryRecord,
  RetrievalQuery,
  ScoredMemory,
  EmotionalLandscape,
  InductionSummary,
  SimilarityMode,
} from './types/index.js';
import {
  computeCalcium,
  emotionalSimilarity,
  allocateRetrievalWeights,
  updateDynamics,
  recallBoost,
  reinforcementBoost,
} from './math.js';
import type { RetrievalWeights } from './math.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const DEFAULT_DB_PATH = join(PROJECT_ROOT, 'data', 'webui', 'fusion_memory.db');
const SCHEMA_PATH = join(__dirname, 'schema.sql');

interface SqlJsDatabase {
  run(sql: string, params?: any[]): void;
  exec(sql: string): Array<{
    columns: string[];
    values: any[][];
  }>;
  prepare(sql: string): SqlJsStatement;
  close(): void;
  export(): Uint8Array;
}

interface SqlJsStatement {
  bind(params?: any[]): void;
  step(): boolean;
  getAsObject(): any;
  free(): void;
}

/** 将 EntityGene[] 转为 JSON 字符串 */
function genesToJson(genes: EntityGene[]): string {
  return JSON.stringify(genes.map(g => ({
    name: g.name, type: g.type, allele: g.allele,
    phenotype: g.phenotype, knowledge_type: g.knowledge_type,
  })));
}

/** 从 JSON 字符串恢复 EntityGene[] */
function jsonToGenes(json: string): EntityGene[] {
  try { return JSON.parse(json); } catch (err) { console.warn('[SQLite] jsonToGenes解析失败:', err); return []; }
}

export class SQLiteAdapter {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private ready = false;
  /** 批量 flush：累计写次数，每 N 次或每 T 秒才落盘 */
  private _dirtyCount = 0;
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _FLUSH_BATCH = 5;  // 每5次写入落盘一次
  private readonly _FLUSH_INTERVAL = 2000; // 最长2秒落盘一次

  /** P5: 热点查询缓存（2秒 TTL） */
  private _queryCache = new Map<string, { result: any; expiresAt: number }>();
  private readonly _CACHE_TTL_MS = 2000;

  private _cacheGet<T>(key: string): T | null {
    const entry = this._queryCache.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.result as T;
    this._queryCache.delete(key);
    return null;
  }

  private _cacheSet(key: string, result: any, ttlMs: number = this._CACHE_TTL_MS): void {
    this._queryCache.set(key, { result, expiresAt: Date.now() + ttlMs });
    if (this._queryCache.size > 50) {
      const now = Date.now();
      for (const [k, v] of this._queryCache) {
        if (v.expiresAt <= now) this._queryCache.delete(k);
      }
    }
  }

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? DEFAULT_DB_PATH;
  }

  async initialize(): Promise<void> {
    // @ts-ignore
    const SQL = await initSqlJs();
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer) as unknown as SqlJsDatabase;
    } else {
      this.db = new SQL.Database() as unknown as SqlJsDatabase;
    }

    // 执行 DDL
    const ddl = readFileSync(SCHEMA_PATH, 'utf-8');
    this.db.run(ddl);

    // 迁移：为已有数据库追加 vad_spectrum 列（SQLite 不支持 IF NOT EXISTS）
    try { this.db.run("ALTER TABLE memories ADD COLUMN vad_spectrum TEXT"); } catch { /* 列已存在 */ }
    try { this.db.run("ALTER TABLE memories ADD COLUMN primary_emotion TEXT"); } catch { /* 列已存在 */ }
    try { this.db.run("ALTER TABLE memories ADD COLUMN secondary_emotions TEXT"); } catch { /* 列已存在 */ }
    try { this.db.run("ALTER TABLE memories ADD COLUMN promoted_to_diamond INTEGER DEFAULT 0"); } catch { /* 列已存在 */ }

    // 索引迁移：emotion 列可能在新库中已在 DDL 中创建，旧库需通过迁移创建
    try { this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_emotion ON memories(primary_emotion)"); } catch { /* 列不存在或索引已存在 */ }

    // 迁移：知识库分类字段（铁律 — 无分类不检索）
    try { this.db.run("ALTER TABLE knowledge_base ADD COLUMN classification TEXT"); } catch { /* 列已存在 */ }
    try { this.db.run("ALTER TABLE knowledge_base ADD COLUMN classification_pending INTEGER DEFAULT 1"); } catch { /* 列已存在 */ }

    // 迁移：vault_log 表
    try { const fullDdl = readFileSync(SCHEMA_PATH, 'utf-8'); this.db.run(fullDdl); } catch (e2) { console.warn('[SQLite] vault_log表迁移失败:', e2); }

    // P1-1: 黑钻库 emotion_vector 列迁移
    try { this.db.run("ALTER TABLE black_diamond ADD COLUMN emotion_vector TEXT DEFAULT NULL"); } catch { /* 列已存在 */ }

    // S2-6: 知识库印象值 + 最近召回时间
    try { this.db.run("ALTER TABLE knowledge_base ADD COLUMN impression_score REAL DEFAULT 0.5"); } catch { /* 列已存在 */ }
    try { this.db.run("ALTER TABLE knowledge_base ADD COLUMN last_recalled_at TEXT"); } catch { /* 列已存在 */ }

    // SP3-3: 黑钻库 FTS5 全文索引（加速检索）
    try {
      this.db.run("CREATE VIRTUAL TABLE IF NOT EXISTS black_diamond_fts USING fts5(summary, tags, content='black_diamond', content_rowid='rowid')");
      // 同步已有数据到 FTS5 索引（首次运行时）
      this.db.run("INSERT OR IGNORE INTO black_diamond_fts(rowid, summary, tags) SELECT rowid, summary, tags FROM black_diamond");
    } catch (e) { console.warn('[SQLite] FTS5 索引初始化失败:', e); }

    this.ready = true;
    console.log(`[SQLiteAdapter] 初始化完成: ${this.dbPath}`);
  }

  close(): void {
    if (this.db) this.db.close();
    this.ready = false;
  }

  // ─── 砂金库：全量对话活档案 ───

  /** 写入一条对话记录（即时落盘） */
  insertConversation(role: string, content: string, options?: {
    seqPos?: number; topic?: string; entityNames?: string[];
    perception?: { pleasure: number; arousal: number; intimacy: number };
    calciumScore?: number;
  }): number {
    this.ensureReady();
    const now = new Date().toISOString();
    this.runSql(
      'INSERT INTO conversations (role, content, timestamp, seq_pos, topic, entity_names, perception_summary, calcium_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [role, content, now, options?.seqPos ?? null, options?.topic ?? null,
       options?.entityNames ? JSON.stringify(options.entityNames) : null,
       options?.perception ? JSON.stringify(options.perception) : null,
       options?.calciumScore ?? null]
    );
    this.save();
    return this.queryAll('SELECT last_insert_rowid() as id')[0]?.id as number || 0;
  }

  /** 搜索砂金库对话（降级检索用） */
  searchConversations(keyword: string, limit = 10): Array<{ id: number; role: string; content: string; timestamp: string; topic?: string }> {
    this.ensureReady();
    return this.queryAll(
      'SELECT id, role, content, timestamp, topic FROM conversations WHERE content LIKE ? AND is_summary = 0 ORDER BY timestamp DESC LIMIT ?',
      ['%' + keyword + '%', limit]
    );
  }

  /** 按实体名搜索（M4降级路径） */
  searchConversationsByEntity(entityName: string, limit = 10): Array<{ id: number; role: string; content: string; timestamp: string }> {
    this.ensureReady();
    return this.queryAll(
      'SELECT id, role, content, timestamp FROM conversations WHERE entity_names LIKE ? AND is_summary = 0 ORDER BY timestamp DESC LIMIT ?',
      ['%' + entityName + '%', limit]
    );
  }

  /** 按时间范围检索（"上周说了什么"） */
  findByTimeRange(start: string, end: string, limit = 20): Array<{ id: number; role: string; content: string; timestamp: string }> {
    this.ensureReady();
    return this.queryAll(
      'SELECT id, role, content, timestamp FROM conversations WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC LIMIT ?',
      [start, end, limit]
    );
  }

  /** 获取砂金库统计 */
  getConversationStats(): { total: number; userCount: number; assistantCount: number; oldest: string; newest: string } {
    this.ensureReady();
    const rows = this.queryAll(
      "SELECT COUNT(*) as total, SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) as userCount, SUM(CASE WHEN role='assistant' THEN 1 ELSE 0 END) as assistantCount, MIN(timestamp) as oldest, MAX(timestamp) as newest FROM conversations"
    );
    const r = rows[0] || { total: 0, userCount: 0, assistantCount: 0, oldest: '', newest: '' };
    return { total: Number(r.total) || 0, userCount: Number(r.userCount) || 0, assistantCount: Number(r.assistantCount) || 0, oldest: String(r.oldest || ''), newest: String(r.newest || '') };
  }

  /** 获取最近对话（供 LLM 上下文拼接） */
  getRecentConversations(limit = 100): Array<{ role: string; content: string; timestamp: string }> {
    this.ensureReady();
    const rows = this.queryAll<{ role: string; content: string; timestamp: string }>(
        'SELECT role, content, timestamp FROM conversations WHERE is_summary = 0 ORDER BY timestamp DESC LIMIT ?',
        [limit]
      );
      return rows.reverse();
  }

  // ─── 写入 ───

  write(record: EmotionalMemoryRecord): void {
    this.ensureReady();
    const pJson = JSON.stringify([
      record.perception.pleasure, record.perception.arousal,
      record.perception.dominance, record.perception.aggression,
      record.perception.sincerity, record.perception.humor,
      record.perception.factual, record.perception.logical,
      record.perception.certainty, record.perception.abstract,
      record.perception.temporal_focus, record.perception.self_ref,
      record.perception.intimacy, record.perception.power_diff,
      record.perception.dependency, record.perception.moral_judgment,
      record.perception.etiquette, record.perception.belonging,
      record.perception.sexual_attraction, record.perception.sensory_craving,
      record.perception.energy_merge, record.perception.possessiveness,
      record.perception.ecstasy, record.perception.safety,
    ]);

    this.runSql(
      `INSERT OR REPLACE INTO memories
      (id, seq_pos, created_at, perception_json,
       calcium_score, calcium_level,
       locus_path, leaf_zone, raw_input,
       recall_count, last_recalled_at,
       reinforcement_accumulator, effective_strength, strength_updated_at,
       is_landmark, landmarked_at, narrative_tag, sensory_anchor,
       scar_type, scar_healed,
       vad_spectrum,
       primary_emotion, secondary_emotions)
      VALUES (?, ?, ?, ?,
              ?, ?,
              ?, ?, ?,
              ?, ?,
              ?, ?, ?,
              ?, ?, ?, ?,
              ?, ?,
              ?,
              ?, ?)`,
      [
        record.id, record.seq_pos, record.created_at, pJson,
        record.calcium_score, record.calcium_level,
        record.locus_path, record.leaf_zone, record.raw_input,
        record.recall_count, record.last_recalled_at,
        record.reinforcement_accumulator, record.effective_strength, record.strength_updated_at,
        record.is_landmark ? 1 : 0, record.landmarked_at,
        record.narrative_tag ?? null, record.sensory_anchor ?? null,
        record.scar?.type ?? null, record.scar?.healed ? 1 : record.scar ? 0 : null,
        record.vad_spectrum ? JSON.stringify(record.vad_spectrum) : null,
        record.primary_emotion ?? null,
        record.secondary_emotions ? JSON.stringify(record.secondary_emotions) : null,
      ],
    );

    // 写入实体关联
    for (const gene of record.entity_genes) {
      this.ensureEntity(gene.name, gene.type);
      this.runSql(
        `INSERT OR IGNORE INTO memory_entities (memory_id, entity_id, allele, phenotype, knowledge_type)
        VALUES (?, (SELECT id FROM entities WHERE name=? AND type=?), ?, ?, ?)`,
        [record.id, gene.name, gene.type, gene.allele, gene.phenotype, gene.knowledge_type],
      );
    }

    // 持久化到磁盘
    this.save();
  }

  private ensureEntity(name: string, type: string): void {
    this.runSql(
      `INSERT OR IGNORE INTO entities (name, type) VALUES (?, ?)`,
      [name, type],
    );
  }

  // ─── 读取 ───

  /** 按 seq_pos 范围读取 */
  findBySeqPosRange(start: number, end: number, limit = 50): EmotionalMemoryRecord[] {
    this.ensureReady();
    const res = this.execSql(
      `SELECT * FROM memories WHERE seq_pos >= ? AND seq_pos <= ?
       ORDER BY seq_pos DESC LIMIT ?`,
      [start, end, limit],
    );
    return this.rowsToRecords(res);
  }

  /** 带衰减门控的检索 — 过滤低强度记忆，按 (strength * calcium) 排序 */
  findBySeqPosRangeWithStrength(start: number, end: number, limit = 50, minStrength = 0.05): EmotionalMemoryRecord[] {
    this.ensureReady();
    // 先拉取较多候选，再在应用层排序
    const res = this.execSql(
      `SELECT * FROM memories WHERE seq_pos >= ? AND seq_pos <= ?
       ORDER BY seq_pos DESC LIMIT ?`,
      [start, end, Math.min(limit * 3, 200)],
    );
    const records = this.rowsToRecords(res);
    // 过滤 + 排序（按 strength * calcium 综合分降序）
    return records
      .filter(r => r.effective_strength >= minStrength)
      .sort((a, b) => (b.effective_strength * b.calcium_score) - (a.effective_strength * a.calcium_score))
      .slice(0, limit);
  }

  /** 按 strength 过滤的 findByLocus */
  findByLocusWithStrength(locusPath: string, limit = 20, minStrength = 0.05): EmotionalMemoryRecord[] {
    this.ensureReady();
    const res = this.execSql(
      `SELECT * FROM memories WHERE locus_path LIKE ?
       ORDER BY seq_pos DESC LIMIT ?`,
      [`${locusPath}%`, limit * 2],
    );
    return this.rowsToRecords(res)
      .filter(r => r.effective_strength >= minStrength)
      .slice(0, limit);
  }

  /** 按 locus_path 前缀匹配 */
  findByLocus(locusPath: string, limit = 20): EmotionalMemoryRecord[] {
    this.ensureReady();
    const res = this.execSql(
      `SELECT * FROM memories WHERE locus_path LIKE ?
       ORDER BY seq_pos DESC LIMIT ?`,
      [`${locusPath}%`, limit],
    );
    return this.rowsToRecords(res);
  }

  /** 按 branch_id 精确查询（含实体关联） */
  findById(id: string): EmotionalMemoryRecord | null {
    this.ensureReady();
    const res = this.execSql(
      `SELECT * FROM memories WHERE id = ? LIMIT 1`,
      [id],
    );
    if (res.length === 0 || res[0].values.length === 0) return null;
    const { columns, values } = res[0];
    const record = this.rowToRecord(values[0], columns);

    // 加载实体关联
    try {
      const entRes = this.execSql(
        `SELECT e.name, e.type, me.allele, me.phenotype, me.knowledge_type
         FROM memory_entities me JOIN entities e ON me.entity_id = e.id
         WHERE me.memory_id = ?`,
        [id],
      );
      if (entRes.length > 0) {
        const genes: EntityGene[] = [];
        for (const rowVals of entRes[0].values) {
          const cols = entRes[0].columns;
          const rowObj: Record<string, any> = {};
          for (let i = 0; i < cols.length; i++) rowObj[cols[i]] = rowVals[i];
          genes.push({
            name: rowObj.name as string,
            type: rowObj.type as any,
            allele: rowObj.allele as string,
            phenotype: rowObj.phenotype as any,
            knowledge_type: rowObj.knowledge_type as any,
          });
        }
        record.entity_genes = genes;
      }
    } catch (err) { console.warn('[SQLite] findById entity加载失败:', err); }

    return record;
  }

  /** 获取总记录数 */
  getTotalCount(): number {
    this.ensureReady();
    const res = this.execSql(`SELECT COUNT(*) as cnt FROM memories`);
    if (res.length > 0 && res[0].values.length > 0) {
      return res[0].values[0][0] as number;
    }
    return 0;
  }

  // ─── 情感检索（核心新能力） ───

  /**
   * 按情感相似度检索。
   * 遍历全部记录，计算加权余弦相似度，返回 Top-N。
   * 后续可优化为 KD-tree 索引。
   */
  findByEmotionalSimilarity(query: RetrievalQuery): ScoredMemory[] {
    this.ensureReady();
    // P5: Hot cache — same query within 2s returns cached result
    const cacheKey = 'ems_' + query.similarity_mode + '_' + query.limit + '_' + (query.locus_path || '') + '_' + (query.entities?.slice().sort().join(',') || '') + '_' + JSON.stringify(query.current_perception);
    const cached = this._cacheGet<ScoredMemory[]>(cacheKey);
    if (cached) return cached;

    const startTime = performance.now();
    const weights = allocateRetrievalWeights(
      query.entities?.length ?? 0,
      query.current_perception.arousal,
      query.similarity_mode,
    );

    // P6: Tier 1 — landmark fast path (is_landmark = 1, typically < 10 records)
    const landmarkRows = this.execSql(
      `SELECT * FROM memories WHERE is_landmark = 1 ORDER BY calcium_score DESC LIMIT 20`,
    );
    let landmarkRecords = this.rowsToRecords(landmarkRows)
      .filter(r => r.effective_strength >= 0.05);

    const allScored: ScoredMemory[] = [];
    const landmarkIds = new Set<string>();

    // Score landmarks
    for (const record of landmarkRecords) {
      landmarkIds.add(record.id);
      const score = this._scoreMemory(record, query, weights);
      if (score) allScored.push(score);
    }

    // If not enough results from landmarks, do Tier 2: recent memory scan
    if (allScored.length < query.limit) {
      const all = this.execSql(
        `SELECT * FROM memories ORDER BY seq_pos DESC LIMIT 200`,
      );
      const records = this.rowsToRecords(all)
        .filter(r => r.effective_strength >= 0.05 && !landmarkIds.has(r.id));

      for (const record of records) {
        const score = this._scoreMemory(record, query, weights);
        if (score) allScored.push(score);
      }
    }

    const result = allScored
      .sort((a, b) => b.composite - a.composite)
      .slice(0, query.limit);

    // P7: Query observability
    const elapsed = performance.now() - startTime;
    if (elapsed > 100) {
      console.warn(`[SQLite] SLOW QUERY [findByEmotionalSimilarity]: ${elapsed.toFixed(0)}ms`);
    }

    this._cacheSet(cacheKey, result);
    return result;
  }

  /** P6: Score a single memory record against the query */
  private _scoreMemory(record: EmotionalMemoryRecord, query: RetrievalQuery, weights: RetrievalWeights): ScoredMemory | null {
    const emotional = emotionalSimilarity(
      query.current_perception,
      record.perception,
      query.similarity_mode,
      query.current_perception, // P1-1: 当前感知驱动动态权重
    );

    const topic = query.locus_path
      ? (record.locus_path.startsWith(query.locus_path) ? 1.0 : 0.0)
      : 0;

    let entityOverlap = 0;
    if (query.entities && query.entities.length > 0) {
      const recordNames = new Set(record.entity_genes.map(g => g.name));
      const matched = query.entities.filter(e => recordNames.has(e)).length;
      const union = new Set([...query.entities, ...recordNames]).size;
      entityOverlap = union > 0 ? matched / union : 0;
    }

    const calcium = record.calcium_score;

    // P9: VAD bonus — if record has VAD spectrum, add small boost for matching valence/arousal
    let vadBonus = 0;
    if (record.vad_spectrum) {
      try {
        const vs = typeof record.vad_spectrum === 'string' ? JSON.parse(record.vad_spectrum) : record.vad_spectrum;
        if (vs.overall) {
          const vValence = vs.overall.valence ?? 0.5;
          const vArousal = vs.overall.arousal ?? 0.5;
          const pValence = (query.current_perception.pleasure + 1) / 2; // normalize -1..1 to 0..1
          const pArousal = query.current_perception.arousal;
          const vadSim = 1 - (Math.abs(vValence - pValence) + Math.abs(vArousal - pArousal)) / 2;
          vadBonus = vadSim * 0.1;
        }
      } catch { /* VAD parse failure is non-fatal */ }
    }

    const str = record.effective_strength ?? 0.5;
    const composite = isNaN(str) ? 0.5 : str * (
      weights.emotional * emotional +
      weights.topic * topic +
      weights.entity * entityOverlap +
      weights.calcium * calcium
    ) + vadBonus;

    const safeComposite = isNaN(composite) ? 0 : Math.max(0, Math.min(1, composite));

    if (safeComposite > 0.05) {
      return {
        record,
        scores: { emotional, topic, entity: entityOverlap, calcium },
        composite: safeComposite,
      };
    }
    return null;
  }

  // ─── 记忆动力学更新 ───

  /** 更新召回避次数 + 重新巩固增强 */
  updateRecall(memoryIds: string[]): void {
    this.ensureReady();
    const now = new Date().toISOString();
    for (const id of memoryIds) {
      const record = this.findById(id);
      if (!record) continue;

      record.recall_count++;
      record.last_recalled_at = now;
      const boost = recallBoost(record.effective_strength);
      record.effective_strength = Math.min(1.0, record.effective_strength + boost);
      record.strength_updated_at = now;

      this.write(record);
    }
  }

  /** 批量衰减维护 */
  runDecayMaintenance(): { total: number; archived: number } {
    this.ensureReady();
    const all = this.execSql(`SELECT * FROM memories`);
    const records = this.rowsToRecords(all);
    const now = new Date();
    let archived = 0;

    for (const record of records) {
      const before = record.effective_strength;
      updateDynamics(record, now);

      // 记录衰减日志
      const lastUpdate = record.strength_updated_at
        ? Math.max(0, (now.getTime() - new Date(record.strength_updated_at).getTime()) / 86_400_000)
        : 0;
      this.runSql(
        `INSERT INTO decay_log (memory_id, checked_at, strength_before, strength_after, days_elapsed)
         VALUES (?, ?, ?, ?, ?)`,
        [record.id, now.toISOString(), before, record.effective_strength, lastUpdate],
      );

      this.write(record);
      if (record.effective_strength < 0.05) archived++;
    }

    return { total: records.length, archived };
  }

  /** 情感相似事件增强 */
  applyReinforcement(
    newPerception: Perception24D,
    newCalcium: number,
    memoryIds: string[],
  ): void {
    this.ensureReady();
    const now = new Date().toISOString();
    for (const id of memoryIds) {
      const record = this.findById(id);
      if (!record) continue;

      const similarity = emotionalSimilarity(newPerception, record.perception, 'balanced');
      if (similarity < 0.3) continue;

      const boost = reinforcementBoost(record.calcium_score, newCalcium, similarity);
      record.reinforcement_accumulator += boost;
      record.effective_strength = Math.min(1.0, record.effective_strength + boost * 0.1);
      record.strength_updated_at = now;

      this.write(record);
    }
  }

  // ─── 年轮/地标视图 ───

  /** 获取情感地形图（含非地标疤痕记忆） */
  getEmotionalLandscape(): EmotionalLandscape {
    this.ensureReady();
    // 1. 地标记录
    const landmarks = this.execSql(
      `SELECT * FROM memories WHERE is_landmark = 1
       ORDER BY calcium_score DESC LIMIT 50`,
    );
    const peakRecords = this.rowsToRecords(landmarks);

    // 2. 非地标但有疤痕的记录（疤痕可能出现在晋升地标前）
    const scarredNonLandmarks = this.execSql(
      `SELECT * FROM memories WHERE scar_type IS NOT NULL AND is_landmark = 0`,
    );
    const scarredRecords = this.rowsToRecords(scarredNonLandmarks);

    const allRecords = [...peakRecords, ...scarredRecords];

    return {
      peaks: allRecords.map(r => ({
        id: r.id,
        created_at: r.created_at,
        calcium: r.calcium_score,
        pleasure: r.perception.pleasure,
        intimacy: r.perception.intimacy,
        snippet: r.raw_input.substring(0, 60),
        narrative_tag: r.narrative_tag,
      })),
      scars: allRecords
        .filter(r => r.scar && !r.scar.healed)
        .map(r => ({
          id: r.id,
          created_at: r.created_at,
          calcium: r.calcium_score,
          pleasure: r.perception.pleasure,
          type: r.scar!.type,
          snippet: r.raw_input.substring(0, 60),
        })),
      cluster_count: peakRecords.length,
    };
  }

  /** 晋升为地标 */
  promoteToLandmark(memoryId: string, narrativeTag?: string, sensoryAnchor?: string): boolean {
    this.ensureReady();
    const record = this.findById(memoryId);
    if (!record) return false;

    record.is_landmark = true;
    record.landmarked_at = new Date().toISOString();
    if (narrativeTag) record.narrative_tag = narrativeTag;
    if (sensoryAnchor) record.sensory_anchor = sensoryAnchor;

    this.write(record);
    return true;
  }

  // ─── 状态 ───

  getStatus(): { totalRecords: number; landmarks: number; totalEntities: number } {
    this.ensureReady();
    const cnt = this.execSql(`SELECT
      (SELECT COUNT(*) FROM memories) as totalRecords,
      (SELECT COUNT(*) FROM memories WHERE is_landmark=1) as landmarks,
      (SELECT COUNT(*) FROM entities) as totalEntities`);
    const row = cnt[0]?.values[0];
    return {
      totalRecords: row?.[0] ?? 0,
      landmarks: row?.[1] ?? 0,
      totalEntities: row?.[2] ?? 0,
    };
  }

  /** 更新已存在记忆的 VAD 谱曲字段（异步谱曲完成后调用） */
  updateVadSpectrum(memoryId: string, vad: any): boolean {
    this.ensureReady();
    try {
      const vadJson = JSON.stringify(vad);
      this.runSql(
        `UPDATE memories SET vad_spectrum = ? WHERE id = ?`,
        [vadJson, memoryId],
      );
      this.save();
      return true;
    } catch (err) {
      console.warn(`[SQLite] updateVadSpectrum 失败:`, err);
      return false;
    }
  }

  /**
   * 通过实体重叠查找关联的知识条目。
   * 找到与当前实体同现的过往记忆 → 通过 knowledge_memories 反向查出知识条目。
   * 用于在关键词搜索之外提供"情感关联"维度的知识补充。
   */
  findKnowledgeByEntityOverlap(entityNames: string[], limit = 5): Array<{ id: string; title: string; content: string; source_type: string; tags: string }> {
    this.ensureReady();
    if (entityNames.length === 0) return [];

    const placeholders = entityNames.map(() => '?').join(',');
    try {
      const results = this.execSql(
        `SELECT DISTINCT kb.id, kb.title, kb.content, kb.source_type, kb.tags
         FROM knowledge_base kb
         JOIN knowledge_memories km ON km.knowledge_id = kb.id
         JOIN memories m ON m.id = km.memory_id
         JOIN memory_entities me ON me.memory_id = m.id
         JOIN entities e ON e.id = me.entity_id
         WHERE e.name IN (${placeholders})
         ORDER BY km.relevance DESC
         LIMIT ?`,
        [...entityNames, limit],
      );
      if (results.length === 0) return [];
      const { columns, values } = results[0];
      return values.map((row: any[]) => {
        const obj: Record<string, any> = {};
        columns.forEach((col: string, idx: number) => { obj[col] = row[idx]; });
        return {
          id: obj.id as string,
          title: obj.title as string,
          content: obj.content as string,
          source_type: obj.source_type as string,
          tags: obj.tags as string,
        };
      });
    } catch (err) {
      console.warn('[SQLite] findKnowledgeByEntityOverlap 失败:', err);
      return [];
    }
  }

  /** 直接执行 SQL */
  writeRaw(sql: string, ...params: any[]): void {
    this.ensureReady();
    this.runSql(sql, params.length > 0 ? params : undefined);
    this.save();
  }

  /** P8: 类型安全查询 — 默认返回 Record<string, unknown>，可显式泛型约束 */
  queryAll<T = Record<string, unknown>>(sql: string, params?: any[]): T[] {
    this.ensureReady();
    const result = this.execSql(sql, params);
    if (result.length === 0) return [];
    const { columns, values } = result[0];
    return values.map((row: any[]) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col: string, idx: number) => { obj[col] = row[idx]; });
      return obj as T;
    });
  }


  // ─── P2: 金库管理 API ───

  /** 获取单条记忆 */
  getMemoryById(id: string): Record<string, unknown> | null {
    this.ensureReady();
    const rows = this.queryAll('SELECT * FROM memories WHERE id = ?', [id]);
    return rows.length > 0 ? rows[0] : null;
  }

  /** 锁定记忆（阻止衰减）*/
  lockMemory(id: string): boolean {
    this.ensureReady();
    try {
      this.runSql('UPDATE memories SET effective_strength = 1.0, strength_updated_at = ? WHERE id = ?', [new Date().toISOString(), id]);
      this.save();
      return true;
    } catch { return false; }
  }

  /** 删除记忆 */
  deleteMemory(id: string): boolean {
    this.ensureReady();
    try {
      this.runSql('DELETE FROM memories WHERE id = ?', [id]);
      this.save();
      return true;
    } catch { return false; }
  }

  /** 标记记忆 */
  tagMemory(id: string, tag: string): boolean {
    this.ensureReady();
    try {
      const existing = this.queryAll('SELECT narrative_tag FROM memories WHERE id = ?', [id]);
      if (existing.length > 0) {
        const oldTag = existing[0].narrative_tag || '';
        const newTag = oldTag ? oldTag + ',' + tag : tag;
        this.runSql('UPDATE memories SET narrative_tag = ? WHERE id = ?', [newTag, id]);
        this.save();
      }
      return true;
    } catch { return false; }
  }

  /** 按情绪标签检索 */
  findByEmotion(emotion: string, limit = 20): EmotionalMemoryRecord[] {
    this.ensureReady();
    const res = this.execSql(
      'SELECT * FROM memories WHERE primary_emotion = ? ORDER BY calcium_score DESC LIMIT ?',
      [emotion, limit]
    );
    return this.rowsToRecords(res);
  }

  /** 金库统计 */
  getGoldStats(): Record<string, number | string> {
    this.ensureReady();
    const rows = this.queryAll(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_landmark = 1 THEN 1 ELSE 0 END) as landmarks,
        SUM(CASE WHEN scar_type IS NOT NULL THEN 1 ELSE 0 END) as scarred,
        SUM(CASE WHEN calcium_level >= 2 THEN 1 ELSE 0 END) as highCalcium,
        AVG(effective_strength) as avgStrength,
        MIN(created_at) as oldest,
        MAX(created_at) as newest
      FROM memories`
    );
    const r = rows[0] || {};
    return {
      total: Number(r.total) || 0, landmarks: Number(r.landmarks) || 0,
      scarred: Number(r.scarred) || 0, highCalcium: Number(r.highCalcium) || 0,
      avgStrength: Number(r.avgStrength) || 0,
      oldest: String(r.oldest || ''), newest: String(r.newest || ''),
    };
  }

  // ─── 实体关系检索 ───

  /**
   * 根据当前实体名称，查找实体关系图中关联的其他实体。
   * 例如："加班" → 查到 "累"、"深夜"、"压力"
   */
  findRelatedEntities(entityNames: string[], minStrength = 0.3): Array<{
    name: string;
    relation: string;
    strength: number;
  }> {
    this.ensureReady();
    if (entityNames.length === 0) return [];

    const placeholders = entityNames.map(() => '?').join(',');
    const results = this.execSql(
      `SELECT e.name, er.relation, er.strength
       FROM entity_relations er
       JOIN entities e ON e.id = er.entity_b_id
       WHERE er.entity_a_id IN (SELECT id FROM entities WHERE name IN (${placeholders}))
         AND er.strength >= ?
       UNION
       SELECT e.name, er.relation, er.strength
       FROM entity_relations er
       JOIN entities e ON e.id = er.entity_a_id
       WHERE er.entity_b_id IN (SELECT id FROM entities WHERE name IN (${placeholders}))
         AND er.strength >= ?
       ORDER BY strength DESC
       LIMIT 15`,
      [...entityNames, minStrength, ...entityNames, minStrength],
    );

    if (results.length === 0) return [];
    const { columns, values } = results[0];
    return values.map((row: any[]) => ({
      name: row[columns.indexOf('name')] as string,
      relation: row[columns.indexOf('relation')] as string,
      strength: row[columns.indexOf('strength')] as number,
    }));
  }

  /**
   * P1-3: 多跳实体关联检索（支持 1-3 度扩展）
   * 保护机制：单实体最多返回 8 条，超限截断。
   */
  findRelatedEntitiesN(entityNames: string[], maxHops: 1|2|3 = 1, minStrength = 0.3, maxAgeDays?: number): Array<{
    name: string;
    relation: string;
    strength: number;
    hop: number;
  }> {
    this.ensureReady();
    if (entityNames.length === 0 || maxHops < 1) return [];
    // P0-4: 默认过滤超过2年的弱关联
    const cutoffDate = maxAgeDays !== undefined
      ? new Date(Date.now() - maxAgeDays * 86400000).toISOString()
      : new Date(Date.now() - 730 * 86400000).toISOString();
    const seen = new Set<string>();
    const results: Array<{ name: string; relation: string; strength: number; hop: number }> = [];
    let currentLayer = [...entityNames];
    let hop = 1;
    while (hop <= maxHops && currentLayer.length > 0 && results.length < 8) {
      const placeholders = currentLayer.map(() => "?").join(",");
      const rows = this.execSql(
        `SELECT e.name, er.relation, er.strength
         FROM entity_relations er
         JOIN entities e ON e.id = er.entity_b_id
         WHERE er.entity_a_id IN (SELECT id FROM entities WHERE name IN (${placeholders}))
           AND er.strength >= ?
           AND (er.updated_at IS NULL OR er.updated_at >= ?)
         UNION
         SELECT e.name, er.relation, er.strength
         FROM entity_relations er
         JOIN entities e ON e.id = er.entity_a_id
         WHERE er.entity_b_id IN (SELECT id FROM entities WHERE name IN (${placeholders}))
           AND er.strength >= ?
           AND (er.updated_at IS NULL OR er.updated_at >= ?)
         ORDER BY strength DESC
         LIMIT 15`,
        [...currentLayer, minStrength, cutoffDate, ...currentLayer, minStrength, cutoffDate],
      );
      if (rows.length === 0 || !rows[0].values) break;
      const columns = rows[0].columns;
      const nextLayer: string[] = [];
      for (const row of rows[0].values) {
        const name = row[columns.indexOf("name")] as string;
        if (seen.has(name) || entityNames.includes(name)) continue;
        seen.add(name);
        results.push({ name, relation: row[columns.indexOf("relation")] as string, strength: row[columns.indexOf("strength")] as number, hop });
        nextLayer.push(name);
        if (results.length >= 8) break;
      }
      currentLayer = nextLayer;
      hop++;
    }
    return results;
  }


  /**
   * 通过实体名称查找关联的记忆。
   * 利用 memory_entities 表做 JOIN，比全文搜索 raw_input 更精准。
   */
  findMemoriesByEntityNames(entityNames: string[], limit = 10): EmotionalMemoryRecord[] {
    this.ensureReady();
    if (entityNames.length === 0) return [];

    const placeholders = entityNames.map(() => '?').join(',');
    const results = this.execSql(
      `SELECT DISTINCT m.* FROM memories m
       JOIN memory_entities me ON me.memory_id = m.id
       JOIN entities e ON e.id = me.entity_id
       WHERE e.name IN (${placeholders})
       ORDER BY m.calcium_score DESC
       LIMIT ?`,
      [...entityNames, limit],
    );

    return this.rowsToRecords(results);
  }

  /** 获取实体关系图摘要（调试用） */
  getEntityRelationSummary(): Array<{
    entityA: string;
    entityB: string;
    relation: string;
    strength: number;
  }> {
    this.ensureReady();
    const results = this.execSql(
      `SELECT a.name as entityA, b.name as entityB, er.relation, er.strength
       FROM entity_relations er
       JOIN entities a ON a.id = er.entity_a_id
       JOIN entities b ON b.id = er.entity_b_id
       ORDER BY er.strength DESC
       LIMIT 30`,
    );
    if (results.length === 0) return [];
    const { columns, values } = results[0];
    return values.map((row: any[]) => ({
      entityA: row[columns.indexOf('entityA')] as string,
      entityB: row[columns.indexOf('entityB')] as string,
      relation: row[columns.indexOf('relation')] as string,
      strength: row[columns.indexOf('strength')] as number,
    }));
  }

  // ─── 私有方法 ───

  private ensureReady(): void {
    if (!this.ready || !this.db) throw new Error('SQLiteAdapter not initialized');
  }

  /** 将内存数据库持久化到磁盘（批量 flush，非每次写入都落盘） */
  private save(): void {
    if (!this.db) return;
    this._dirtyCount++;

    // 每 _FLUSH_BATCH 次直接落盘
    if (this._dirtyCount >= this._FLUSH_BATCH) {
      this.flush();
      return;
    }

    // 否则设定时器兜底（_FLUSH_INTERVAL 内没有再触发 save 则落盘）
    if (!this._flushTimer) {
      this._flushTimer = setTimeout(() => {
        this.flush();
      }, this._FLUSH_INTERVAL);
    }
  }

  /** 强制立即落盘 */
  flush(): void {
    if (!this.db || this._dirtyCount === 0) return;
    try {
      const data = (this.db as any).export();
      const buffer = Buffer.from(data);
      writeFileSync(this.dbPath, buffer);
      this._dirtyCount = 0;
      if (this._flushTimer) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
      }
    } catch (err) {
      console.error('[SQLiteAdapter] flush failed:', err);
    }
  }

  /** sql.js 的 run 方法运行时接受 params，但类型定义可能不完整 */
  private runSql(sql: string, params?: any[]): void {
    (this.db as any).run(sql, params);
  }

  /** 带参数的 exec 查询 */
  private execSql(sql: string, params?: any[]): Array<{ columns: string[]; values: any[][] }> {
    if (params) {
      const stmt = (this.db as any).prepare(sql);
      stmt.bind(params);
      const results: any[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      // 包装为 exec 返回格式
      if (results.length === 0) return [];
      const columns = Object.keys(results[0]);
      const values = results.map(r => columns.map(c => r[c]));
      return [{ columns, values }];
    }
    return (this.db as any).exec(sql);
  }

  private rowToRecord(row: any[] | Record<string, any>, columns?: string[]): EmotionalMemoryRecord {
    // 支持 exec() 返回的两种格式
    let obj: Record<string, any>;
    if (Array.isArray(row) && columns) {
      obj = {};
      for (let i = 0; i < columns.length; i++) obj[columns[i]] = row[i];
    } else {
      obj = row as Record<string, any>;
    }

    const pArr: number[] = typeof obj.perception_json === 'string'
      ? JSON.parse(obj.perception_json)
      : obj.perception_json ?? Array(24).fill(0.5);

    const perception: Perception24D = {
      pleasure: pArr[0], arousal: pArr[1], dominance: pArr[2],
      aggression: pArr[3], sincerity: pArr[4], humor: pArr[5],
      factual: pArr[6], logical: pArr[7], certainty: pArr[8],
      abstract: pArr[9], temporal_focus: pArr[10], self_ref: pArr[11],
      intimacy: pArr[12], power_diff: pArr[13], dependency: pArr[14],
      moral_judgment: pArr[15], etiquette: pArr[16], belonging: pArr[17],
      sexual_attraction: pArr[18], sensory_craving: pArr[19],
      energy_merge: pArr[20], possessiveness: pArr[21],
      ecstasy: pArr[22], safety: pArr[23],
    };

    return {
      id: obj.id,
      seq_pos: obj.seq_pos,
      created_at: obj.created_at,
      perception,
      calcium_score: obj.calcium_score,
      calcium_level: obj.calcium_level as 0 | 1 | 2 | 3,
      raw_input: obj.raw_input,
      locus_path: obj.locus_path,
      entity_genes: [], // 实体会在 rowsToRecords 或 findById 中填充
      leaf_zone: obj.leaf_zone,
      recall_count: obj.recall_count ?? 0,
      last_recalled_at: obj.last_recalled_at ?? null,
      reinforcement_accumulator: obj.reinforcement_accumulator ?? 0,
      effective_strength: obj.effective_strength ?? 1.0,
      strength_updated_at: obj.strength_updated_at ?? obj.created_at,
      is_landmark: obj.is_landmark === 1 || obj.is_landmark === true,
      landmarked_at: obj.landmarked_at ?? null,
      narrative_tag: obj.narrative_tag ?? undefined,
      sensory_anchor: obj.sensory_anchor ?? undefined,
      scar: obj.scar_type ? {
        type: obj.scar_type,
        healed: obj.scar_healed === 1,
        healed_at: null,
      } : undefined,
      vad_spectrum: obj.vad_spectrum ? JSON.parse(obj.vad_spectrum) : null,
      primary_emotion: obj.primary_emotion ?? undefined,
      secondary_emotions: obj.secondary_emotions ? JSON.parse(obj.secondary_emotions) : undefined,
      promoted_to_diamond: obj.promoted_to_diamond === 1 || obj.promoted_to_diamond === true,
    };
  }

  private rowsToRecords(results: Array<{ columns: string[]; values: any[][] }>): EmotionalMemoryRecord[] {
    if (results.length === 0) return [];
    const { columns, values } = results[0];
    const records = values.map((row: any[]) => this.rowToRecord(row, columns));

    // 批量加载实体关联（替代 N+1 单条查询）
    if (records.length > 0) {
      try {
        const ids = records.map(r => r.id).filter(Boolean);
        if (ids.length > 0) {
          const placeholders = ids.map(() => '?').join(',');
          const entRes = this.execSql(
            `SELECT me.memory_id, e.name, e.type, me.allele, me.phenotype, me.knowledge_type
             FROM memory_entities me JOIN entities e ON me.entity_id = e.id
             WHERE me.memory_id IN (${placeholders})`,
            ids,
          );
          if (entRes.length > 0) {
            // 将实体按 memory_id 分组
            const entityMap = new Map<string, EntityGene[]>();
            for (const rowVals of entRes[0].values) {
              const cols = entRes[0].columns;
              const rowObj: Record<string, any> = {};
              for (let i = 0; i < cols.length; i++) rowObj[cols[i]] = rowVals[i];
              const mid = rowObj.memory_id as string;
              if (!entityMap.has(mid)) entityMap.set(mid, []);
              entityMap.get(mid)!.push({
                name: rowObj.name as string,
                type: rowObj.type as any,
                allele: rowObj.allele as string,
                phenotype: rowObj.phenotype as any,
                knowledge_type: rowObj.knowledge_type as any,
              });
            }
            // 将批量加载的实体应用到每条记录
            for (const rec of records) {
              if (entityMap.has(rec.id)) {
                rec.entity_genes = entityMap.get(rec.id)!;
              }
            }
          }
        }
      } catch (err) {
        console.warn('[SQLite] 批量加载实体失败:', err);
      }
    }

    return records;
  }
}
