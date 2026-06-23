/**
 * Migration — 数据库迁移
 *
 * 从 SQL 文件加载 schema 并执行初始化。
 * 支持增量迁移（检查已存在的表）。
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DatabaseAdapter {
  run(sql: string, ...params: any[]): Promise<any>;
  queryAll(sql: string, ...params: any[]): Promise<any[]>;
  close(): Promise<void>;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export class Migration {
  constructor(private db: DatabaseAdapter) {}

  async runMigrations(): Promise<void> {
    const schemaPath = join(__dirname, 'Schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    // Split by semicolons and execute each statement
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const stmt of statements) {
      try {
        await this.db.run(stmt);
      } catch (err) {
        // Table already exists is acceptable
        const msg = String(err);
        if (msg.includes('already exists')) continue;
        throw err;
      }
    }
  }

  async getVersion(): Promise<number> {
    try {
      const rows = await this.db.queryAll(
        "SELECT value FROM library_config WHERE key = 'schema_version'",
      );
      return parseInt((rows as any[])[0]?.value ?? '0', 10);
    } catch {
      return 0;
    }
  }

  async setVersion(version: number): Promise<void> {
    await this.db.run(
      `INSERT INTO library_config (key, value, updated_at) VALUES ('schema_version', ?, datetime('now','localtime'))
       ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now','localtime')`,
      String(version),
      String(version),
    );
  }
}
