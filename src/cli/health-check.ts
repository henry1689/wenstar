/**
 * 文曲星·玉瑶 每日健康巡检 (v0.1)
 *
 * 运行: DEEPSEEK_API_KEY=sk-xxx npx tsx src/cli/health-check.ts
 * 定时: 每天早上 7:00 Asia/Shanghai (已在 cron 中注册)
 *
 * 5 大维度深度体检，守护灵肉伴侣的核心链路完整性。
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(PROJECT_ROOT, 'data', 'webui');

interface ReportItem {
  status: '✅' | '🔴' | '🟡';
  dimension: string;
  check: string;
  detail: string;
  fix?: string;
}

const report: ReportItem[] = [];

function pass(dim: string, check: string, detail: string) {
  report.push({ status: '✅', dimension: dim, check, detail });
}

function warn(dim: string, check: string, detail: string, fix?: string) {
  report.push({ status: '🟡', dimension: dim, check, detail, fix });
}

function fatal(dim: string, check: string, detail: string, fix?: string) {
  report.push({ status: '🔴', dimension: dim, check, detail, fix });
}

async function loadSQLite(path: string): Promise<any> {
  if (!existsSync(path)) return null;
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const buffer = readFileSync(path);
  return new SQL.Database(buffer);
}

function query(db: any, sql: string, params?: any[]): any[] {
  try {
    if (params) {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows: any[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    }
    const result = db.exec(sql);
    if (result.length === 0) return [];
    const { columns, values } = result[0];
    return values.map((row: any[]) => {
      const obj: any = {};
      columns.forEach((col: string, i: number) => obj[col] = row[i]);
      return obj;
    });
  } catch (e) { return []; }
}

async function run() {
  console.log('\n' + '═'.repeat(50));
  console.log('  文曲星·玉瑶 每日健康巡检');
  console.log('  ' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  console.log('═'.repeat(50) + '\n');

  const DB_PATH = join(DATA_DIR, 'fusion_memory.db');
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
  let db = null;
  try {
    db = await loadSQLite(DB_PATH);
  } catch (e) {
    fatal('数据源', 'SQLite 数据库加载', `无法打开 ${DB_PATH}: ${e}`);
  }

  // ═══════════════════════════════════════
  // 1. 记忆神经通路
  // ═══════════════════════════════════════
  console.log('📡 [维度1] 记忆神经通路');

  if (db) {
    // 1a. 检查 knowledge_memories 是否有数据
    const kmCount = query(db, 'SELECT COUNT(*) as cnt FROM knowledge_memories');
    const kmExists = kmCount.length > 0 && kmCount[0].cnt > 0;
    if (kmExists) {
      pass('记忆神经通路', 'knowledge_memories 关联记录', `存在 ${kmCount[0].cnt} 条知识-记忆关联`);
    } else {
      warn('记忆神经通路', 'knowledge_memories 关联记录', 'knowledge_memories 表为空。知识库和情感记忆尚未建立关联。',
        '检查 chat.ts:155-158 的 knowledge_memories 写入路径');
    }

    // 1b. 检查最近24h写入
    const recentMemories = query(db,
      `SELECT COUNT(*) as cnt FROM memories WHERE created_at >= ?`, [oneDayAgo]);
    if (recentMemories.length > 0 && recentMemories[0].cnt > 0) {
      pass('记忆神经通路', '24h 新增记忆', `24h 内新增 ${recentMemories[0].cnt} 条记忆`);
    } else {
      warn('记忆神经通路', '24h 新增记忆', '24h 内无新增记忆记录', '系统可能未运行或用户未交互');
    }

    // 1c. entity_relations 关联完整性
    const relCount = query(db, 'SELECT COUNT(*) as cnt FROM entity_relations');
    if (relCount.length > 0) {
      pass('记忆神经通路', 'entity_relations 实体关系', `影子库中有 ${relCount[0].cnt} 条实体关系`);
    }

    // 1c-bis. FamilyGraph 主库节点完整性（双库统一迁移后主库状态）
    try {
      const fgPath = join(PROJECT_ROOT, 'data', 'knowledge', 'family_graph.db');
      if (existsSync(fgPath)) {
        const fdb = await loadSQLite(fgPath);
        if (fdb) {
          const nodeCount = query(fdb, "SELECT COUNT(*) as cnt FROM nodes WHERE type = 'person'");
          const edgeCount = query(fdb, 'SELECT COUNT(*) as cnt FROM edges');
          if (nodeCount.length > 0) {
            pass('记忆神经通路', 'FamilyGraph 主库', `人物节点 ${nodeCount[0].cnt} 个, 关系边 ${edgeCount[0]?.cnt ?? 0} 条`);
          }
          fdb.close();
        }
      }
    } catch (_fe) { /* 主库检查为附加信息，失败不阻塞 */ }

    // 1d. 取样检查 knowledge_memories 的 relevance 字段
    const kmSample = query(db,
      `SELECT km.knowledge_id, km.memory_id, km.relevance, k.title
       FROM knowledge_memories km
       LEFT JOIN knowledge_base k ON km.knowledge_id = k.id
       ORDER BY km.rowid DESC LIMIT 3`);
    if (kmSample.length > 0) {
      pass('记忆神经通路', 'knowledge_memories 采样', `最近关联: ${kmSample.map((r: any) => r.title || r.knowledge_id).join(', ')}`);
    }
  }

  // ═══════════════════════════════════════
  // 2. 零LLM认知底座
  // ═══════════════════════════════════════
  console.log('🧠 [维度2] 零LLM认知底座');

  try {
    // 2a 运行烟雾测试 (核心链路)
    const { execSync } = await import('child_process');
    console.log('  运行核心链路 E2E 测试...');
    try {
      const testOutput = execSync(
        `npx vitest run src/__tests__/smoke.test.ts --reporter=verbose`,
        { cwd: PROJECT_ROOT, timeout: 90000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
      ) as string;
      const passed = (testOutput.match(/(\d+) passed/) || [])[1] || '0';
      const failed = (testOutput.match(/(\d+) failed/) || [])[1] || '0';
      if (parseInt(failed) === 0) {
        pass('零LLM认知底座', 'E2E 核心链路测试', `${passed} 项全部通过`);
      } else {
        warn('零LLM认知底座', 'E2E 核心链路测试', `${failed} 项测试失败, ${passed} 项通过`, '运行 npx vitest run 查看详情');
      }
    } catch (testErr: any) {
      // 可能是服务器未运行或超时，降级为警告
      warn('零LLM认知底座', 'E2E 测试执行', `测试执行异常: ${testErr.message?.substring(0, 100)}`, '检查服务器是否运行在 localhost:3000');
    }

    // 2b. 检查 MemoryRetriever.ts 类型安全
    const mrContent = readFileSync(join(PROJECT_ROOT, 'src', 'm4', 'MemoryRetriever.ts'), 'utf-8');
    if (!mrContent.includes('as any')) {
      pass('零LLM认知底座', 'MemoryRetriever 类型安全', '无 as any 类型穿透');
    } else {
      warn('零LLM认知底座', 'MemoryRetriever 类型安全', '存在 as any 类型穿透',
        '检查 src/m4/MemoryRetriever.ts 的 buildContext 返回值类型');
    }
  } catch (e: any) {
    warn('零LLM认知底座', '检查执行', `无法完成检查: ${e.message}`);
  }

  // ═══════════════════════════════════════
  // 3. 情感计算心跳
  // ═══════════════════════════════════════
  console.log('💗 [维度3] 情感计算心跳');

  if (db) {
    // 3a. 检查钙化分值分布
    const calciumStats = query(db,
      `SELECT
        COUNT(*) as total,
        ROUND(AVG(calcium_score), 3) as avg_calcium,
        MIN(calcium_score) as min_calcium,
        MAX(calcium_score) as max_calcium
       FROM memories`);
    if (calciumStats.length > 0) {
      const s = calciumStats[0];
      if (s.avg_calcium > 0 && s.max_calcium <= 1) {
        pass('情感计算心跳', '钙化分值分布', `均值 ${s.avg_calcium}, 范围 [${s.min_calcium}, ${s.max_calcium}], 正常`);
      } else {
        warn('情感计算心跳', '钙化分值分布', `异常值: avg=${s.avg_calcium}, max=${s.max_calcium}`);
      }
    }

    // 3b. 有效记忆占比 (effective_strength > 0.05)
    const strongMem = query(db,
      `SELECT COUNT(*) as cnt FROM memories WHERE effective_strength > 0.05`);
    const totalMem = query(db, `SELECT COUNT(*) as cnt FROM memories`);
    if (strongMem.length > 0 && totalMem.length > 0) {
      const ratio = (strongMem[0].cnt / Math.max(1, totalMem[0].cnt) * 100).toFixed(1);
      if (parseFloat(ratio) > 50) {
        pass('情感计算心跳', '有效记忆占比', `${ratio}% 记忆处于有效状态`);
      } else {
        warn('情感计算心跳', '有效记忆占比', `仅 ${ratio}% 记忆有效`, '建议检查衰减参数是否过于激进');
      }
    }

    // 3c. 地标记忆 (is_landmark)
    const landmarks = query(db,
      `SELECT COUNT(*) as cnt FROM memories WHERE is_landmark = 1`);
    if (landmarks.length > 0) {
      pass('情感计算心跳', '年轮地标', `已晋升 ${landmarks[0].cnt} 条地标记忆`);
    }
  }

  // ═══════════════════════════════════════
  // 4. 数据持久化安全
  // ═══════════════════════════════════════
  console.log('💾 [维度4] 数据持久化安全');

  // 4a. 检查 SQLiteAdapter flush 配置
  const sqliteContent = readFileSync(join(PROJECT_ROOT, 'src', 'm2', 'SQLiteAdapter.ts'), 'utf-8');
  const hasFlushBatch = sqliteContent.includes('_FLUSH_BATCH = 5');
  const hasFlushInterval = sqliteContent.includes('_FLUSH_INTERVAL = 2000');
  if (hasFlushBatch && hasFlushInterval) {
    pass('数据持久化安全', '批量 flush 配置', '5次写入/2秒防抖, 配置正确');
  } else {
    fatal('数据持久化安全', '批量 flush 配置', '批量 flush 未正确配置',
      '检查 SQLiteAdapter.ts 中 _FLUSH_BATCH 和 _FLUSH_INTERVAL');
  }

  // 4b. 检查 JSON Zone 备份
  const zonesDir = join(DATA_DIR, 'zones');
  if (existsSync(zonesDir)) {
    const zoneFiles = readdirSync(zonesDir).filter(f => f.endsWith('.json'));
    if (zoneFiles.length > 0) {
      const allFresh = zoneFiles.every(f => {
        const mtime = statSync(join(zonesDir, f)).mtimeMs;
        return (Date.now() - mtime) < 86400000;
      });
      if (allFresh) {
        pass('数据持久化安全', 'JSON Zone 备份', `${zoneFiles.length} 个备份文件均在24h内更新`);
      } else {
        warn('数据持久化安全', 'JSON Zone 备份', '部分备份文件超过24h未更新');
      }
    } else {
      warn('数据持久化安全', 'JSON Zone 备份', 'Zone 备份目录为空');
    }
  } else {
    warn('数据持久化安全', 'JSON Zone 备份', 'Zone 备份目录不存在');
  }

  // 4c. 检查对话历史文件可解析
  const convPath = join(DATA_DIR, 'conversations.json');
  if (existsSync(convPath)) {
    try {
      const conv = JSON.parse(readFileSync(convPath, 'utf-8'));
      pass('数据持久化安全', '对话历史文件', `${Array.isArray(conv) ? conv.length : 0} 条对话记录可解析`);
    } catch {
      fatal('数据持久化安全', '对话历史文件', 'conversations.json 损坏无法解析',
        '检查文件格式，尝试从备份恢复');
    }
  }

  // ═══════════════════════════════════════
  // 5. 线索回忆活性
  // ═══════════════════════════════════════
  console.log('🔍 [维度5] 线索回忆活性');

  if (db) {
    // 5a. 地标总数
    const lmCount = query(db, `SELECT COUNT(*) as cnt FROM memories WHERE is_landmark = 1`);
    const lmTotal = lmCount.length > 0 ? lmCount[0].cnt : 0;
    if (lmTotal >= 50) {
      pass('线索回忆活性', 'M8 地标数量', `${lmTotal} 条地标, 线索检索数据充足`);
    } else if (lmTotal >= 10) {
      warn('线索回忆活性', 'M8 地标数量', `仅 ${lmTotal} 条地标 (<50)`,
        '请降低 ConsolidationQueue 晋升阈值或增加对话量');
    } else {
      warn('线索回忆活性', 'M8 地标数量', `仅 ${lmTotal} 条地标 (<10)`,
        '地标严重不足，线索回忆功能可能无结果返回。建议检查 ConsolidationQueue 是否运行');
    }

    // 5b. ClueTracker 日志
    try {
      const cluePath = join(PROJECT_ROOT, 'data', 'dreams', 'interaction_logs.json');
      if (existsSync(cluePath)) {
        const logs = JSON.parse(readFileSync(cluePath, 'utf-8'));
        if (Array.isArray(logs) && logs.length > 0) {
          pass('线索回忆活性', 'ClueTracker 日志', `${logs.length} 条线索检索记录`);
        } else {
          warn('线索回忆活性', 'ClueTracker 日志', '线索日志为空',
            '用户未触发过模糊查询或 matchByClue 未返回结果');
        }
      } else {
        warn('线索回忆活性', 'ClueTracker 日志', '日志文件不存在',
          '需首次触发线索检索后才会生成');
      }
    } catch {
      warn('线索回忆活性', 'ClueTracker 日志', '无法读取');
    }

    // 5c. 24h 地标增长率
    const recentLandmarks = query(db,
      `SELECT COUNT(*) as cnt FROM memories WHERE is_landmark = 1 AND landmarked_at >= ?`,
      [oneDayAgo]);
    if (recentLandmarks.length > 0 && recentLandmarks[0].cnt > 0) {
      pass('线索回忆活性', '24h 地标增长', `24h 内新增 ${recentLandmarks[0].cnt} 条地标`);
    } else if (lmTotal > 0) {
      warn('线索回忆活性', '24h 地标增长', '24h 内地标无增长',
        'ConsolidationQueue 空闲巩固可能未触发，检查 IDLE_THRESHOLD 配置');
    }
  }

  // ═══════════════════════════════════════
  // 输出报告
  // ═══════════════════════════════════════
  const fatals = report.filter(r => r.status === '🔴');
  const warns = report.filter(r => r.status === '🟡');
  const passes = report.filter(r => r.status === '✅');

  console.log('\n' + '═'.repeat(50));
  console.log('  体检报告');
  console.log('═'.repeat(50));
  console.log(`  ✅ 通过: ${passes.length}  |  🟡 警告: ${warns.length}  |  🔴 致命: ${fatals.length}`);
  console.log('');

  for (const item of report) {
    const icon = item.status === '✅' ? '✅' : item.status === '🔴' ? '🔴' : '🟡';
    console.log(`  ${icon} [${item.dimension}] ${item.check}`);
    console.log(`     ${item.detail}`);
    if (item.fix) console.log(`     🔧 ${item.fix}`);
    console.log('');
  }

  // ═══════════════════════════════════════
  // ═══════════════════════════════════════
  // 灵肉活力摘要
  // ═══════════════════════════════════════
  const hasCritical = fatals.length > 0;
  const hasWarning = warns.length > 0;

  let summary = '';
  if (hasCritical) {
    summary = `🔴 系统存在 ${fatals.length} 项致命问题，需要立即干预。` +
      fatals.map(f => `[${f.dimension}] ${f.check}: ${f.detail}`).join('；');
  } else if (hasWarning) {
    summary = `🟡 系统运行正常，存在 ${warns.length} 项需关注项。` +
      warns.map(w => `${w.check}: ${w.detail}`).join('；');
  } else {
    summary = '💚 记忆通路畅通，情感心跳平稳，核心认知链路完整。可安全进行今日调试。';
  }

  console.log('═'.repeat(50));
  console.log('  灵肉活力摘要');
  console.log('═'.repeat(50));
  console.log(`  ${summary}`);
  console.log(`  巡检时间: ${new Date().toISOString()}`);
  console.log('═'.repeat(50) + '\n');

  // 如果有致命项，非零退出
  if (hasCritical) process.exit(1);
}

run().catch(err => {
  console.error('[HealthCheck] 巡检执行异常:', err);
  process.exit(2);
});
