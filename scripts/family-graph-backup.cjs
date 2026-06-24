#!/usr/bin/env node
/**
 * 家族图谱自动备份脚本
 * 用途：将 family_graph.db 备份到 data/backups/，保留最近30天备份
 * 可通过 cron 每天执行一次
 */
const { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } = require('fs');
const { join } = require('path');

const DB_PATH = 'data/webui/knowledge/family_graph.db';
const BACKUP_DIR = 'data/backups';
const MAX_BACKUPS = 30;

function backup() {
  if (!existsSync(DB_PATH)) {
    console.error('[FamilyBackup] 数据库文件不存在: ' + DB_PATH);
    return false;
  }

  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  const now = new Date();
  const dateStr = [
    now.getFullYear(),
    String(now.getMonth()+1).padStart(2,'0'),
    String(now.getDate()).padStart(2,'0'),
    String(now.getHours()).padStart(2,'0'),
    String(now.getMinutes()).padStart(2,'0'),
  ].join('');
  const backupName = 'family_graph_' + dateStr + '.db';
  const backupPath = join(BACKUP_DIR, backupName);

  try {
    const data = readFileSync(DB_PATH);
    writeFileSync(backupPath, data);
    console.log('[FamilyBackup] ✅ 已备份: ' + backupName + ' (' + (data.length/1024).toFixed(1) + 'KB)');
  } catch (err) {
    console.error('[FamilyBackup] ❌ 备份失败:', err.message);
    return false;
  }

  // 清理旧备份（保留最近 MAX_BACKUPS 个）
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('family_graph_') && f.endsWith('.db'))
      .sort()
      .reverse();
    if (files.length > MAX_BACKUPS) {
      for (const old of files.slice(MAX_BACKUPS)) {
        unlinkSync(join(BACKUP_DIR, old));
        console.log('[FamilyBackup] 🗑️ 清理旧备份: ' + old);
      }
    }
  } catch (err) {
    console.warn('[FamilyBackup] 清理旧备份失败:', err.message);
  }

  return true;
}

// 自检功能
function selfCheck() {
  try {
    const initSqlJs = require('sql.js');
    (async () => {
      const SQL = await initSqlJs();
      const db = new SQL.Database(readFileSync(DB_PATH));
      const stats = {
        totalPersons: 0,
        withEdges: 0,
        withProfiles: 0,
        backupCount: 0,
        fileSizeKB: 0,
      };

      const nodes = db.exec("SELECT name, properties FROM nodes WHERE type='person'");
      if (nodes.length) {
        for (const row of nodes[0].values) {
          stats.totalPersons++;
          const props = JSON.parse(row[1] || '{}');
          if (props.relation_to_user) stats.withProfiles++;
          const edges = db.exec('SELECT id FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE name=?) OR target_id IN (SELECT id FROM nodes WHERE name=?)', [row[0], row[0]]);
          if (edges.length && edges[0].values.length) stats.withEdges++;
        }
      }

      stats.fileSizeKB = Math.round(readFileSync(DB_PATH).length / 1024);

      try {
        const files = readdirSync(BACKUP_DIR).filter(f => f.startsWith('family_graph_'));
        stats.backupCount = files.length;
      } catch {}

      console.log('\n══════════ 家族图谱自检报告 ══════════');
      console.log('  人物节点:     ' + stats.totalPersons);
      console.log('  有档案:       ' + stats.withProfiles + '/' + stats.totalPersons);
      console.log('  有关联边:     ' + stats.withEdges + '/' + stats.totalPersons);
      console.log('  文件大小:     ' + stats.fileSizeKB + 'KB');
      console.log('  备份数量:     ' + stats.backupCount);
      console.log('═══════════════════════════════════\n');

      const healthy = stats.totalPersons > 0 && stats.withEdges >= stats.totalPersons * 0.8;
      return { healthy, stats };
    })().catch(err => { console.error('[FamilyBackup] 自检失败:', err.message); });
  } catch (err) {
    console.error('[FamilyBackup] 自检不可用(sql.js未安装):', err.message);
  }
}

// CLI 参数
const arg = process.argv[2];
if (arg === '--check' || arg === '--self-check') {
  selfCheck();
} else if (arg === '--help') {
  console.log('用法: node scripts/family-graph-backup.cjs [--check|--backup]');
  console.log('  (无参数)  备份 + 自检');
  console.log('  --check   仅自检');
  console.log('  --backup  仅备份');
} else {
  const ok = backup();
  if (ok) selfCheck();
}
