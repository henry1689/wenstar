#!/usr/bin/env node
/**
 * 黑钻库旧数据 emotion_vector 批量回填脚本
 *
 * 遍历所有 emotion_vector 为空的 black_diamond 条目，
 * 根据 emotion_tag 填充对应的近似 24D 情感向量。
 *
 * 使用: node scripts/backfill-blackdiamond-vectors.cjs
 */
const path = require('path');
const fs = require('fs');

// ─── 情感标签 → 近似 24D 向量映射 ───
const TAG_VECTORS = {
  '开心': [0.7,0.6,0.5,0.1,0.6,0.4,0.2,0.3,0.5,0.2,0.3,0.3,0.4,0.1,0.3,0.4,0.5,0.5,0.3,0.2,0.3,0.1,0.4,0.6],
  '感动': [0.6,0.3,0.4,0.0,0.7,0.2,0.3,0.2,0.4,0.3,0.4,0.5,0.5,0.1,0.4,0.5,0.5,0.6,0.2,0.2,0.3,0.1,0.3,0.5],
  '难过': [-0.5,-0.3,-0.3,0.2,0.5,0.0,0.3,0.2,0.3,0.3,0.5,0.5,0.2,0.2,0.5,0.3,0.3,0.3,0.0,0.1,0.1,0.1,0.0,0.2],
  '思念': [0.3,0.2,0.2,0.0,0.6,0.1,0.3,0.2,0.3,0.4,0.5,0.6,0.5,0.1,0.4,0.4,0.4,0.5,0.2,0.2,0.2,0.2,0.2,0.4],
  '愤怒': [-0.6,0.7,0.3,0.8,0.1,0.0,0.4,0.3,0.6,0.1,0.2,0.3,0.0,0.5,0.2,0.2,0.2,0.1,0.1,0.3,0.0,0.4,0.1,0.1],
  '亲密': [0.7,0.6,0.4,0.0,0.5,0.3,0.1,0.2,0.4,0.2,0.3,0.4,0.7,0.2,0.5,0.3,0.4,0.5,0.6,0.5,0.6,0.5,0.6,0.5],
  '焦虑': [-0.3,0.6,-0.2,0.3,0.3,0.0,0.4,0.3,0.2,0.3,0.5,0.5,0.2,0.3,0.4,0.3,0.3,0.2,0.2,0.3,0.1,0.3,0.1,0.1],
  '温暖': [0.6,0.3,0.5,0.0,0.7,0.3,0.2,0.2,0.5,0.2,0.3,0.3,0.5,0.0,0.4,0.5,0.5,0.6,0.2,0.2,0.3,0.1,0.3,0.6],
  '中性': [0.0,0.0,0.0,0.0,0.3,0.1,0.3,0.3,0.3,0.2,0.3,0.3,0.0,0.0,0.2,0.3,0.3,0.3,0.0,0.0,0.0,0.0,0.0,0.3],
};

const PROJECT_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'webui', 'fusion_memory.db');

async function main() {
  let SQL;
  try {
    SQL = require('sql.js');
  } catch (e) {
    // sql.js might need dynamic import in ESM context
    const m = await import('sql.js');
    SQL = m.default || m;
  }
  const initSqlJs = SQL.default || SQL;
  const sql = await initSqlJs();

  if (!fs.existsSync(DB_PATH)) {
    console.error('数据库不存在:', DB_PATH);
    process.exit(1);
  }

  const buf = fs.readFileSync(DB_PATH);
  const db = new sql.Database(buf);

  // 查找所有 emotion_vector 为空的条目
  const rows = db.exec("SELECT id, emotion_tag FROM black_diamond WHERE emotion_vector IS NULL OR emotion_vector = ''");
  if (rows.length === 0 || !rows[0].values) {
    console.log('没有需要回填的条目');
    db.close();
    return;
  }

  const values = rows[0].values;
  let updated = 0;

  for (const row of values) {
    const id = row[0];
    const tag = row[1] || '中性';
    const vec = TAG_VECTORS[tag];
    const finalVec = vec || TAG_VECTORS['中性'];

    db.run("UPDATE black_diamond SET emotion_vector = ? WHERE id = ?", [JSON.stringify(finalVec), id]);
    updated++;
  }

  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  console.log('✅ 已回填 ' + updated + ' 条黑钻条目的 emotion_vector');
}

main().catch(function(err) {
  console.error('回填失败:', err.message);
  process.exit(1);
});
