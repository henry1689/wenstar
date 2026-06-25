/**
 * ConversationDB — P0-9 对话独立存储库（已合入 fusion_memory.db）
 *
 * v2.0: 构造函数接受 existingDb 参数，共享 sql.js 实例而非独立文件。
 * 保留独立文件模式向后兼容。flush 在共享模式下为空操作
 *（由 SQLiteAdapter 统一落盘管理）。
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const DEFAULT_DB_PATH = join(PROJECT_ROOT, 'data', 'webui', 'conversations.db');

interface ConversationRow {
  id: number;
  role: string;
  content: string;
  timestamp: string;
  topic?: string;
  entity_names?: string;
  is_summary: number;
  seq_pos: number;
  perception_summary?: string;
  calcium_score?: number;
}

export class ConversationDB {
  private db: any = null;
  private dbPath: string;
  private initialized = false;
  private sharedMode = false;

  constructor(dbPath?: string, existingDb?: any) {
    if (existingDb) {
      this.db = existingDb;        // 共享 fusion_memory.db 实例
      this.sharedMode = true;
      this.initialized = true;
      this.dbPath = '(shared)';
      return;
    }
    this.dbPath = dbPath || DEFAULT_DB_PATH;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      if (this.sharedMode) {
        // 共享模式下确保新字段存在（ALTER TABLE 兼容旧库）
        this.ensureFields();
      }
      return;
    }
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (existsSync(this.dbPath)) {
      const buf = readFileSync(this.dbPath);
      this.db = new SQL.Database(buf);
    } else {
      this.db = new SQL.Database();
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seq_pos INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        topic TEXT,
        entity_names TEXT,
        perception_summary TEXT,
        calcium_score REAL DEFAULT 0,
        dna_root_id TEXT,
        dialog_group_id TEXT,
        dialog_round INTEGER DEFAULT 0,
        is_compacted INTEGER DEFAULT 0,
        is_test INTEGER DEFAULT 0
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations(timestamp DESC)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_conv_seq ON conversations(seq_pos)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_conv_dna_root ON conversations(dna_root_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_conv_dg ON conversations(dialog_group_id)`);
    this.initialized = true;
    console.log('[ConversationDB] 初始化完成: ' + this.dbPath);
  }

  /** 共享模式下兼容旧库字段 */
  private ensureFields(): void {
    if (!this.db) return;
    try { this.db.run("ALTER TABLE conversations ADD COLUMN dna_root_id TEXT"); } catch {}
    try { this.db.run("ALTER TABLE conversations ADD COLUMN dialog_group_id TEXT"); } catch {}
    try { this.db.run("ALTER TABLE conversations ADD COLUMN dialog_round INTEGER DEFAULT 0"); } catch {}
    try { this.db.run("ALTER TABLE conversations ADD COLUMN is_compacted INTEGER DEFAULT 0"); } catch {}
    try { this.db.run("ALTER TABLE conversations ADD COLUMN is_test INTEGER DEFAULT 0"); } catch {}
  }

  insertConversation(role: string, content: string, options?: {
    seqPos?: number;
    topic?: string;
    entityNames?: string[];
    perception?: Record<string, number>;
    calciumScore?: number;
    dnaRootId?: string;          // 新增：关联到DNA代码段
    dialogGroupId?: string;      // 新增：关联到语义块对话组
    dialogRound?: number;        // 新增：对话组内轮次
    isTest?: number;             // 新增：测试标记
    isCompacted?: number;        // 新增：压缩标记
  }): number {
    this.ensureReady();
    const seqPos = options?.seqPos ?? 0;
    const timestamp = new Date().toISOString();
    const entityNames = options?.entityNames?.join(',') || '';
    const perceptionSummary = options?.perception ? JSON.stringify(options.perception) : '';
    this.db.run(
      `INSERT INTO conversations (role, content, timestamp, seq_pos, topic, entity_names, perception_summary, calcium_score, dna_root_id, dialog_group_id, dialog_round, is_test, is_compacted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [role, content, timestamp, seqPos, options?.topic || '', entityNames, perceptionSummary,
       options?.calciumScore || 0, options?.dnaRootId || null, options?.dialogGroupId || null,
       options?.dialogRound ?? null, options?.isTest ?? 0, options?.isCompacted ?? 0],
    );
    if (!this.sharedMode) this.flush();
    return seqPos;
  }

  getRecentConversations(limit = 100): ConversationRow[] {
    this.ensureReady();
    const stmt = this.db.prepare(
      `SELECT id, role, content, timestamp, topic, is_summary FROM conversations WHERE is_compacted = 0 ORDER BY timestamp DESC LIMIT ?`,
    );
    stmt.bind([limit]);
    const rows: ConversationRow[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as any);
    stmt.free();
    return rows.reverse();
  }

  searchConversations(keyword: string, limit = 10): ConversationRow[] {
    this.ensureReady();
    const stmt = this.db.prepare(
      `SELECT id, role, content, timestamp, topic FROM conversations WHERE content LIKE ? AND is_compacted = 0 ORDER BY timestamp DESC LIMIT ?`,
    );
    stmt.bind([`%${keyword}%`, limit]);
    const rows: ConversationRow[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as any);
    stmt.free();
    return rows;
  }

  findByTimeRange(start: string, end: string, limit = 10): ConversationRow[] {
    this.ensureReady();
    const stmt = this.db.prepare(
      `SELECT id, role, content, timestamp FROM conversations WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC LIMIT ?`,
    );
    stmt.bind([start, end, limit]);
    const rows: ConversationRow[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject() as any);
    stmt.free();
    return rows;
  }

  getConversationStats(): { total: number; userCount: number; assistantCount: number; oldest: string; newest: string } {
    this.ensureReady();
    const stmt = this.db.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) as userCount,
              SUM(CASE WHEN role='assistant' THEN 1 ELSE 0 END) as assistantCount,
              MIN(timestamp) as oldest, MAX(timestamp) as newest FROM conversations`,
    );
    stmt.bind([]);
    const result: any = stmt.step() ? stmt.getAsObject() : { total: 0, userCount: 0, assistantCount: 0, oldest: '', newest: '' };
    stmt.free();
    return result;
  }

  writeRaw(sql: string, ...params: any[]): void {
    this.ensureReady();
    this.db.run(sql, params.length > 0 ? params : undefined);
    if (!this.sharedMode) this.flush();
  }

  queryAll(sql: string, params?: any[]): any[] {
    this.ensureReady();
    const stmt = this.db.prepare(sql);
    if (params) stmt.bind(params);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  close(): void {
    if (this.db && !this.sharedMode) { this.flush(); this.db.close(); this.db = null; }
  }

  private flush(): void {
    if (!this.db || this.sharedMode) return;
    try {
      const data = this.db.export();
      writeFileSync(this.dbPath, Buffer.from(data));
    } catch (err) {
      console.error('[ConversationDB] 落盘失败:', err);
    }
  }

  private ensureReady(): void {
    if (!this.db) throw new Error('ConversationDB not initialized');
  }
}
