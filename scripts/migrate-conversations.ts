/**
 * 🚚 存量对话迁移脚本 — 旧 conversations.db → fusion_memory.db
 *
 * 用途：将独立 conversations.db 中的存量数据合并到 fusion_memory.db 的 conversations 表
 * 去重策略：content + timestamp 相同视为重复跳过
 * 关联回填：按 seq_pos 匹配 memories 表提取 dna_root_id
 *
 * 运行: npx tsx scripts/migrate-conversations.ts
 */
import initSqlJs from 'sql.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const OLD_DB_PATH = join(PROJECT_ROOT, 'data', 'webui', 'conversations.db');
const FM_DB_PATH = join(PROJECT_ROOT, 'data', 'webui', 'fusion_memory.db');

interface MigrationReport {
  totalOld: number;
  migrated: number;
  skipped: number;
  backfilled: number;
  errors: number;
}

async function main() {
  const SQL = await initSqlJs();
  const report: MigrationReport = { totalOld: 0, migrated: 0, skipped: 0, backfilled: 0, errors: 0 };

  if (!existsSync(OLD_DB_PATH)) {
    console.log('旧 conversations.db 不存在，无需迁移');
    return;
  }

  console.log('=== 存量对话迁移 ===\n');

  // 1. 读取旧库
  const oldBuf = readFileSync(OLD_DB_PATH);
  const oldDb = new SQL.Database(oldBuf);
  const oldRows = oldDb.exec('SELECT role, content, timestamp, seq_pos, topic, entity_names, perception_summary, calcium_score, is_summary FROM conversations ORDER BY id ASC');
  if (!oldRows.length || !oldRows[0].values.length) {
    console.log('旧 conversations.db 为空，无需迁移');
    oldDb.close();
    return;
  }
  report.totalOld = oldRows[0].values.length;
  console.log(`旧库: ${report.totalOld} 条对话`);

  // 2. 读取融合库
  const fmBuf = readFileSync(FM_DB_PATH);
  const fmDb = new SQL.Database(fmBuf);

  // 确保 conversations 表存在（含新字段兼容旧库）
  fmDb.run(`CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, seq_pos INTEGER NOT NULL DEFAULT 0,
    role TEXT NOT NULL, content TEXT NOT NULL, timestamp TEXT NOT NULL,
    topic TEXT, entity_names TEXT, perception_summary TEXT,
    calcium_score REAL DEFAULT 0, dna_root_id TEXT, dialog_group_id TEXT,
    dialog_round INTEGER DEFAULT 0, is_compacted INTEGER DEFAULT 0, is_test INTEGER DEFAULT 0
  )`);
  // 兼容旧库：新字段可能不存在
  try { fmDb.run("ALTER TABLE conversations ADD COLUMN is_compacted INTEGER DEFAULT 0"); } catch {}
  try { fmDb.run("ALTER TABLE conversations ADD COLUMN dna_root_id TEXT"); } catch {}
  try { fmDb.run("ALTER TABLE conversations ADD COLUMN dialog_group_id TEXT"); } catch {}
  try { fmDb.run("ALTER TABLE conversations ADD COLUMN dialog_round INTEGER DEFAULT 0"); } catch {}
  try { fmDb.run("ALTER TABLE conversations ADD COLUMN is_test INTEGER DEFAULT 0"); } catch {}
  // 兼容 memories 表 dna_root_id 字段
  try { fmDb.run("ALTER TABLE memories ADD COLUMN dna_root_id TEXT"); } catch {}

  // 构建去重索引 (content+timestamp 哈希集合)
  const existing = fmDb.exec('SELECT content, timestamp FROM conversations');
  const existingSet = new Set<string>();
  if (existing.length > 0) {
    for (const row of existing[0].values) {
      existingSet.add(`${row[0]}|${row[1]}`);
    }
  }
  console.log(`融合库已有: ${existingSet.size} 条`);

  // 3. 逐条迁移
  const insertStmt = fmDb.prepare(
    `INSERT INTO conversations (role, content, timestamp, seq_pos, topic, entity_names, perception_summary, calcium_score, is_compacted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let migrated = 0, skipped = 0, errors = 0;
  const migratedRows: Array<{ seqPos: number; content: string }> = [];

  for (const row of oldRows[0].values) {
    const [role, content, timestamp, seqPos, topic, entityNames, perceptionSummary, calciumScore, isSummary] = row;
    const key = `${content}|${timestamp}`;

    if (existingSet.has(key)) { skipped++; continue; }

    try {
      insertStmt.bind([
        role, content, timestamp, seqPos ?? 0, topic ?? null,
        entityNames ?? null, perceptionSummary ?? null,
        calciumScore ?? 0, isSummary === 1 ? 1 : 0,
      ]);
      insertStmt.step();
      insertStmt.reset();
      migrated++;
      migratedRows.push({ seqPos: seqPos ?? 0, content: (content as string).substring(0, 30) });
    } catch (e) {
      errors++;
    }
  }
  insertStmt.free();

  report.migrated = migrated;
  report.skipped = skipped;
  report.errors = errors;
  console.log(`迁移: ${migrated}, 跳过(重复): ${skipped}, 错误: ${errors}`);

  // 4. 反向匹配回填 dna_root_id
  if (migrated > 0) {
    let backfilled = 0;
    for (const { seqPos } of migratedRows) {
      const memMatch = fmDb.exec('SELECT dna_root_id FROM memories WHERE seq_pos = ? AND dna_root_id IS NOT NULL LIMIT 1', [seqPos]);
      if (memMatch.length > 0 && memMatch[0].values.length > 0) {
        const dnaRootId = memMatch[0].values[0][0];
        fmDb.run('UPDATE conversations SET dna_root_id = ? WHERE seq_pos = ? AND dna_root_id IS NULL', [dnaRootId, seqPos]);
        backfilled++;
      }
    }
    report.backfilled = backfilled;
    console.log(`反向匹配回填 dna_root_id: ${backfilled} 条`);
  }

  // 5. is_summary → is_compacted
  fmDb.run('UPDATE conversations SET is_compacted = 1 WHERE is_compacted = 0 AND (is_summary = 1 OR content LIKE \'【对话摘要】%\')');
  console.log('is_summary → is_compacted 标记同步完成');

  // 6. 保存融合库
  const data = fmDb.export();
  writeFileSync(FM_DB_PATH, Buffer.from(data));
  console.log(`\n✅ 融合库已保存`);

  // 7. 输出报告
  console.log('\n=== 迁移报告 ===');
  console.log(JSON.stringify(report, null, 2));

  oldDb.close();
  fmDb.close();
}

main().catch(console.error);
