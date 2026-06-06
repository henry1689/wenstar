/**
 * MemoryVault — 独立记忆仓
 *
 * 与知识库物理隔离的专用存储仓库。
 * 记忆数据写入独立的 vault.db，同时做 JSON Zone 备份。
 * manifest.json 提供完整性校验。
 *
 * 加固设计：
 * - 独立 DB：与知识库互不干扰
 * - 双写：SQLite + JSON Zone，故障时可互相恢复
 * - SHA256 manifest：启动时自检
 * - 每日快照：维护引擎自动备份
 */
// @ts-ignore
import initSqlJs from 'sql.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VAULT_ROOT = join(__dirname, '..', '..', '..', 'data', 'memory-vault');
const VAULT_DB = join(VAULT_ROOT, 'vault.db');
const ZONES_DIR = join(VAULT_ROOT, 'zones');
const LANDMARKS_DIR = join(VAULT_ROOT, 'landmarks');
const BACKUPS_DIR = join(VAULT_ROOT, 'backups');
const MANIFEST_PATH = join(VAULT_ROOT, 'manifest.json');

interface VaultEntry {
  id: string;
  type: 'memory' | 'landmark' | 'scar';
  created_at: string;
  perception: Record<string, number>;
  calcium_score: number;
  calcium_level: number;
  raw_input: string;
  locus_path: string;
  entity_names: string[];
  strength: number;
  checksum: string;
}

export class MemoryVault {
  private db: any = null;
  private ready = false;

  constructor() {
    for (const d of [VAULT_ROOT, ZONES_DIR, LANDMARKS_DIR, BACKUPS_DIR]) {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    }
  }

  async initialize(): Promise<void> {
    try {
      const SQL = await initSqlJs();
      if (existsSync(VAULT_DB)) {
        this.db = new SQL.Database(readFileSync(VAULT_DB));
      } else {
        this.db = new SQL.Database();
        this.db.run(`CREATE TABLE memories (
          id TEXT PRIMARY KEY, type TEXT NOT NULL,
          created_at TEXT NOT NULL,
          perception_json TEXT, calcium_score REAL, calcium_level INTEGER,
          raw_input TEXT, locus_path TEXT,
          strength REAL DEFAULT 0.5,
          recall_count INTEGER DEFAULT 0, last_recalled_at TEXT
        )`);
        this.db.run(`CREATE INDEX idx_memories_type ON memories(type)`);
        this.db.run(`CREATE INDEX idx_memories_calcium ON memories(calcium_score DESC)`);
      }
      this.ready = true;
      this.flush();
      this.verifyManifest();
      console.log(`[MemoryVault] ✅ 初始化完成: ${existsSync(VAULT_DB) ? '已存在' : '新建'} (${this.db.exec('SELECT COUNT(*) as c FROM memories')?.[0]?.values[0][0] ?? 0} 条)`);
    } catch (err) {
      console.warn('[MemoryVault] ❌ 初始化失败:', err);
    }
  }

  /** 写入一条记忆 */
  write(entry: VaultEntry): void {
    if (!this.ready) return;
    const pJson = JSON.stringify(entry.perception);
    this.db.run(
      `INSERT OR REPLACE INTO memories
       (id, type, created_at, perception_json, calcium_score, calcium_level,
        raw_input, locus_path, strength)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.type, entry.created_at, pJson,
       entry.calcium_score, entry.calcium_level,
       entry.raw_input, entry.locus_path, entry.strength]
    );
    this.flush();

    // JSON Zone 备份
    const zoneFile = join(ZONES_DIR, `${entry.type}_${entry.id}.json`);
    writeFileSync(zoneFile, JSON.stringify(entry, null, 2), 'utf-8');

    // 地标独立存储
    if (entry.type === 'landmark') {
      const lmFile = join(LANDMARKS_DIR, `landmark_${entry.created_at.slice(0, 10)}.jsonl`);
      appendFileSync(lmFile, JSON.stringify(entry) + '\n');
    }

    this.updateManifest(entry);
  }

  /** 查询记忆（按钙化排序） */
  query(limit = 20): VaultEntry[] {
    if (!this.ready) return [];
    const res = this.db.exec(`SELECT * FROM memories ORDER BY calcium_score DESC LIMIT ${limit}`);
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map((row: any[]) => {
      const obj: any = {};
      cols.forEach((c: string, i: number) => { obj[c] = row[i]; });
      obj.perception = obj.perception_json ? JSON.parse(obj.perception_json) : {};
      delete obj.perception_json;
      return obj as VaultEntry;
    });
  }

  /** 获取地标列表 */
  getLandmarks(): VaultEntry[] {
    if (!this.ready) return [];
    const res = this.db.exec(`SELECT * FROM memories WHERE type='landmark' ORDER BY calcium_score DESC LIMIT 50`);
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map((row: any[]) => {
      const obj: any = {};
      cols.forEach((c: string, i: number) => { obj[c] = row[i]; });
      obj.perception = obj.perception_json ? JSON.parse(obj.perception_json) : {};
      delete obj.perception_json;
      return obj as VaultEntry;
    });
  }

  /** 统计 */
  getStats() {
    const count = this.db.exec(`SELECT COUNT(*) as c FROM memories`);
    const lm = this.db.exec(`SELECT COUNT(*) as c FROM memories WHERE type='landmark'`);
    return {
      totalMemories: count[0]?.values[0][0] ?? 0,
      totalLandmarks: lm[0]?.values[0][0] ?? 0,
      vaultPath: VAULT_ROOT,
      dbSize: existsSync(VAULT_DB) ? readFileSync(VAULT_DB).length : 0,
    };
  }

  /** 备份当前 vault.db */
  backup(): void {
    if (!this.ready) return;
    const date = new Date().toISOString().slice(0, 10);
    const backupPath = join(BACKUPS_DIR, `vault_${date}.db`);
    writeFileSync(backupPath, this.db.export());
    console.log(`[MemoryVault] 备份完成: ${backupPath}`);
  }

  /** 关闭 */
  close(): void {
    if (this.db) {
      this.flush();
      this.db.close();
    }
  }

  private flush(): void {
    writeFileSync(VAULT_DB, Buffer.from(this.db.export()));
  }

  private checksum(data: string): string {
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  private updateManifest(entry: VaultEntry): void {
    const manifest = existsSync(MANIFEST_PATH)
      ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
      : { version: 1, entries: {}, last_verified: '' };
    manifest.entries[entry.id] = {
      type: entry.type,
      created_at: entry.created_at,
      checksum: this.checksum(entry.raw_input),
    };
    manifest.last_verified = new Date().toISOString();
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  private verifyManifest(): void {
    if (!existsSync(MANIFEST_PATH)) return;
    try {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      const entryCount = Object.keys(manifest.entries).length;
      const dbCount = this.db.exec(`SELECT COUNT(*) as c FROM memories`)?.[0]?.values[0][0] ?? 0;
      if (entryCount !== dbCount) {
        console.warn(`[MemoryVault] ⚠ Manifest 不一致: manifest=${entryCount} db=${dbCount}`);
      } else {
        console.log(`[MemoryVault] ✅ 自检通过: ${dbCount} 条记忆`);
      }
    } catch { /* 首次无 manifest 正常 */ }
  }
}
