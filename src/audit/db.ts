/** 数据库访问 — 通过后端API查询，避免文件冲突 */
import { apiGet } from './helpers.js';

/**
 * 返回 mock 数据库对象，接口兼容 sql.js exec() 格式
 * 即: db.exec(sql) → [{ columns: string[], values: any[][] }]
 */
export async function getDb(): Promise<{
  exec(sql: string): Array<{ columns: string[]; values: any[][] }>;
}> {
  return {
    exec(sql: string) {
      // 同步返回，实际 fetch 在内部完成
      // 但由于调用方是 await db.exec()，我们返回 Promise
      throw new Error('Use queryDb() instead');
    },
  };
}

/** 执行 SQL 返回第一行第一列的值 */
export async function queryCount(sql: string): Promise<number> {
  const d = await apiGet(`/api/admin/query?sql=${encodeURIComponent(sql)}`);
  const rows = (d.rows || []) as Record<string, any>[];
  if (rows.length === 0) return 0;
  const keys = Object.keys(rows[0]);
  if (keys.length === 0) return 0;
  return Number(rows[0][keys[0]]) || 0;
}
