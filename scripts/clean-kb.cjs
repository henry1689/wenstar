const fs = require('fs');
const initSqlJs = require('sql.js');

async function run() {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync('D:/wenstar/data/webui/fusion_memory.db'));

  // Run the DDL first to ensure tables exist
  const ddl = fs.readFileSync('D:/wenstar/src/m2/schema.sql', 'utf-8');
  db.run(ddl);

  const before = db.exec("SELECT COUNT(*) as cnt FROM knowledge_base")[0].values[0][0];
  console.log('知识库当前总条数:', before);

  // Delete research entries
  db.run("DELETE FROM knowledge_base WHERE source_type = 'research'");
  db.run("DELETE FROM knowledge_base WHERE title LIKE '研究:%'");

  // Delete user auto-extraction entries (用户信息/用户地址/用户偏好/用户厌恶/用户标签)
  db.run("DELETE FROM knowledge_base WHERE title LIKE '用户%'");

  // Delete paste entries that are auto-saved chat snippets
  db.run("DELETE FROM knowledge_base WHERE source_type = 'paste'");

  const after = db.exec("SELECT COUNT(*) as cnt FROM knowledge_base")[0].values[0][0];
  console.log('清理后条数:', after);

  // Write back
  fs.writeFileSync('D:/wenstar/data/webui/fusion_memory.db', Buffer.from(db.export()));
  console.log('数据库已更新');
}

run().catch(e => console.error(e));
