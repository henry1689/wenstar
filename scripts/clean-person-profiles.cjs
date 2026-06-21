#!/usr/bin/env node
/**
 * 存量脏数据清洗脚本 — P0-1e
 * 清空所有FamilyGraph节点中重复、截断、错分类的脏数据。
 * 执行前自动备份 family_graph.db。
 * 使用: node scripts/clean-person-profiles.cjs
 */
const fs = require("fs");
const path = require("path");

const BACKUP_DIR = path.join(__dirname, "..", "data", "backups");
const FG_PATH = path.join(__dirname, "..", "data", "webui", "knowledge", "family_graph.db");

async function main() {
  if (!fs.existsSync(FG_PATH)) {
    console.error("family_graph.db 不存在:", FG_PATH);
    process.exit(1);
  }

  // 备份
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const bakName = `family_graph_backup_${Date.now()}.db`;
  fs.copyFileSync(FG_PATH, path.join(BACKUP_DIR, bakName));
  console.log("已备份:", bakName);

  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(FG_PATH);
  const db = new SQL.Database(buf);

  const nodes = db.exec("SELECT id, name, properties FROM nodes WHERE type = 'person'");
  if (!nodes[0]?.values) { console.log("无可清洗节点"); db.close(); return; }

  let cleaned = 0;
  for (const row of nodes[0].values) {
    const id = row[0];
    const name = row[1];
    const props = JSON.parse(row[2]);

    let changed = false;

    // 清洗 appearance: 去重
    if (props.appearance) {
      const parts = [...new Set(props.appearance.split(/[，,]/).map(function(s) { return s.trim(); }).filter(Boolean))];
      const clean = parts.join("，");
      if (clean !== props.appearance) { props.appearance = clean; changed = true; }
      // 修复截断数字: 身高1 → 需要寻找上下文复原, 但先标记
      if (/身高\d$/.test(props.appearance)) {
        console.log("  [WARN] " + name + " appearance含截断数字:'" + props.appearance + "'");
      }
    }

    // 清洗 body_features: 去重 + 移除非身体描述
    if (props.body_features) {
      const parts = [...new Set(props.body_features.split(/[，,]/).map((s) => s.trim()).filter(Boolean))];
      const original = [...parts];
      // 移除外貌类错分类：长发/短发/发型等
      const filtered = parts.filter((p) => !/长发|短发|卷发|直发|发|刘海|马尾|丸子头/.test(p));
      if (filtered.length !== original.length) {
        const moved = original.filter((p) => !filtered.includes(p));
        // 将移出的发型特征追加到 appearance
        if (moved.length && props.appearance) {
          const moveItems = moved.filter((m) => !props.appearance.includes(m));
          if (moveItems.length) props.appearance += "，" + moveItems.join("，");
        }
        props.body_features = filtered.join("，");
        changed = true;
        console.log("  矫正 " + name + ": 长发→appearance");
      }
      const deduped = [...new Set(props.body_features.split(/[，,]/).map((s) => s.trim()).filter(Boolean))].join("，");
      if (deduped !== props.body_features) { props.body_features = deduped; changed = true; }
    }

    // 清洗 description: 去重 + 数字补全
    if (props.description) {
      const parts = [...new Set(props.description.split(/[，,]/).map((s) => s.trim()).filter(Boolean))].join("，");
      if (parts !== props.description) { props.description = parts; changed = true; }
      if (/米左右/.test(props.description) || /6米/.test(props.description)) {
        console.log("  矫正 " + name + ": description含截断数字移至appearance");
        if (props.appearance) props.appearance += "，身高1.6米左右";
        else props.appearance = "身高1.6米左右";
        props.description = props.description.replace(/，*6米左右|，*米左右|，*身高\d[米]?左右?/g, "").replace(/^，/, "");
        changed = true;
      }
    }

    if (changed) {
      db.run("UPDATE nodes SET properties = ? WHERE id = ?", [JSON.stringify(props), id]);
      cleaned++;
      console.log("  已清洗: " + name);
    }
  }

  const data = db.export();
  fs.writeFileSync(FG_PATH + ".new", Buffer.from(data));
  fs.renameSync(FG_PATH + ".new", FG_PATH);
  db.close();
  console.log("清洗完成: " + cleaned + " 个节点已修复");
}

main().catch(e => { console.error("清洗失败:", e.message); process.exit(1); });
