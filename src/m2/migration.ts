/**
 * Migration — 旧 JSON 数据迁移到 SQLite 融合存储
 *
 * 读取 data/webui/zones/*.json 中的旧 DNA 记录，
 * 用当前 M1/M3 管线重新分析（获取最新的 24D 感知向量和实体提取），
 * 写入 SQLite 融合存储。
 *
 * 运行: npx tsx src/fusion/migration.ts
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DNAEncoder } from '../m1/DNAEncoder.js';
import { M3LogicOrchestrator } from '../m3/M3LogicOrchestrator.js';
import { FusionStorageAdapter } from './FusionStorageAdapter.js';
import type { SelfModelV1 } from '../m1/types/dna.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(PROJECT_ROOT, 'data', 'webui');

const SELF: SelfModelV1 = {
  identity: { name: 'Hermes', persona: '温柔深情的陪伴者', birth_date: '2026-06-02T00:00:00.000Z' },
  traits: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3 },
  boundaries: ['不提供医疗建议', '不泄露隐私', '不编造事实'],
  preferences: { likes: ['深度对话'], dislikes: ['敷衍'] },
  narrative_identity: '我是玉瑶，与你共处太虚境',
};

interface ZoneRecord {
  position: number;
  seq_pos: number;
  dna: {
    branch_id: string;
    locus_path: string;
    raw_input: string;
    entity_genes: any[];
    created_at: string;
    leaf_zone?: string;
    [key: string]: any;
  };
  written_at: string;
}

async function main() {
  console.log('=== 旧 JSON → SQLite 数据迁移 ===\n');

  // 初始化
  const encoder = new DNAEncoder(SELF);
  const m3 = new M3LogicOrchestrator();
  const storage = new FusionStorageAdapter(DATA_DIR);
  await storage.initialize();

  // 读取所有 zone JSON 文件
  const zonesDir = join(DATA_DIR, 'zones');
  if (!existsSync(zonesDir)) {
    console.log('未找到旧数据目录，跳过迁移');
    return;
  }

  const zoneFiles = readdirSync(zonesDir).filter(f => f.endsWith('.json'));
  let totalMigrated = 0;
  let totalSkipped = 0;
  const seenInputs = new Set<string>();

  for (const zoneFile of zoneFiles) {
    const filePath = join(zonesDir, zoneFile);
    const records: ZoneRecord[] = JSON.parse(readFileSync(filePath, 'utf-8'));

    if (records.length === 0) {
      console.log(`  ${zoneFile}: 空，跳过`);
      continue;
    }

    // 按 seq_pos 排序（最早的先迁移）
    records.sort((a, b) => a.seq_pos - b.seq_pos);

    let zoneMigrated = 0;
    let zoneSkipped = 0;

    for (const record of records) {
      const rawInput = record.dna?.raw_input?.trim();
      if (!rawInput || rawInput.length === 0) {
        zoneSkipped++;
        continue;
      }

      // 去重：相同 raw_input 只迁移一次（防止对话中同一句话反复写入）
      const dedupKey = rawInput.toLowerCase().substring(0, 40);
      if (seenInputs.has(dedupKey)) {
        zoneSkipped++;
        continue;
      }
      seenInputs.add(dedupKey);

      try {
        // M1 编码（用当前词表，获取最新 entity_genes 和 locus_path）
        const dna = encoder.encodeSingle(rawInput);

        // M3 感知分析（获取 24D 向量）
        const decision = m3.decide(dna, {
          current_time: record.dna.created_at || record.written_at,
          current_location: '深圳',
        });

        // 写入 SQLite（携带 24D 感知向量）
        const result = await storage.write(dna, decision.enhanced.perception);
        if (result.success) {
          zoneMigrated++;
        } else {
          zoneSkipped++;
        }
      } catch (err) {
        console.warn(`  ⚠️ 迁移失败: "${rawInput.substring(0, 30)}..."`, (err as Error).message);
        zoneSkipped++;
      }
    }

    console.log(`  ${zoneFile}: ${zoneMigrated} 条迁移, ${zoneSkipped} 条跳过`);
    totalMigrated += zoneMigrated;
    totalSkipped += zoneSkipped;
  }

  console.log(`\n=== 迁移完成 ===`);
  console.log(`  写入: ${totalMigrated} 条`);
  console.log(`  跳过: ${totalSkipped} 条`);

  // 验证
  const status = storage.getSQLite().getStatus();
  console.log(`\n=== SQLite 状态 ===`);
  console.log(`  记忆: ${status.totalRecords} 条`);
  console.log(`  地标: ${status.landmarks} 个`);
  console.log(`  实体: ${status.totalEntities} 个`);

  // 显示情感检索可用
  try {
    const landscape = storage.getEmotionalLandscape();
    console.log(`  情感地形图: ${landscape.peaks.length} 个高峰`);
  } catch (err) { console.warn("[Migration] 跳过:", err); }

  // SQLite 已自动持久化到磁盘
  console.log('  迁移完成 ✓');
}

main().catch(err => {
  console.error('迁移失败:', err);
  process.exit(1);
});
