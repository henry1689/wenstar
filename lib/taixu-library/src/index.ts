/**
 * 太虚图书馆 · 独立模块入口
 *
 * 启动流程:
 * 1. 加载配置
 * 2. 初始化 SQLite
 * 3. 执行数据库迁移
 * 4. 初始化四层目录
 * 5. 启动 HTTP 服务（端口 3737）
 * 6. [可选] 启动 MCP 服务
 * 7. 启动文件夹监控
 * 8. 处理存量文件
 */

import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { DirectoryInit } from './folder-manager/DirectoryInit.js';
import { FolderWatcher } from './folder-manager/FolderWatcher.js';
import { ProcessingPipeline } from './folder-manager/SyncManager.js';
import { HttpServer } from './server/HttpServer.js';
import { McpServer } from './server/McpServer.js';
import { Migration, type DatabaseAdapter } from './storage/Migration.js';
import { RawStore } from './storage/RawStore.js';
import { WikiStore } from './storage/WikiStore.js';
import { SchemaStore } from './storage/SchemaStore.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// SQLite adapter using better-sqlite3 or sql.js
// This uses a lightweight embedded SQLite adapter
class SqliteAdapter implements DatabaseAdapter {
  private db: any = null;

  async init(dbPath: string): Promise<void> {
    const { readFileSync, existsSync } = await import('node:fs');
    const initSqlJs = await import('sql.js');
    const SQL = await initSqlJs.default();

    let sqlDb: any;
    if (existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      sqlDb = new SQL.Database(buffer);
    } else {
      sqlDb = new SQL.Database();
    }

    this.db = sqlDb;

    // Save periodically
    setInterval(() => this.save(dbPath), 60000);
    process.on('exit', () => this.save(dbPath));
    process.on('SIGINT', () => { this.save(dbPath); process.exit(0); });
  }

  private save(dbPath: string): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      mkdirSync(dirname(dbPath), { recursive: true });
      writeFileSync(dbPath, Buffer.from(data));
    } catch (err) {
      logger.error('Failed to save database:', err);
    }
  }

  async run(sql: string, ...params: any[]): Promise<any> {
    this.db.run(sql, params);
    return { changes: this.db.getRowsModified() };
  }

  async queryAll(sql: string, ...params: any[]): Promise<any[]> {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const results: any[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  async close(): Promise<void> {
    if (this.db) this.db.close();
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  logger.info('=== 太虚图书馆 v1.0 ===');
  logger.info(`Port: ${config.port}`);
  logger.info(`Data dir: ${config.dataDir}`);
  logger.info(`Watch dir: ${config.watchDir}`);

  // 1. Initialize SQLite
  const dbPath = join(config.dataDir, 'library.db');
  const adapter = new SqliteAdapter();
  await adapter.init(dbPath);

  // 2. Run migrations
  const migration = new Migration(adapter);
  await migration.runMigrations();
  const version = await migration.getVersion();
  logger.info(`Database schema version: ${version}`);

  // 3. Initialize stores
  const rawStore = new RawStore(adapter);
  const wikiStore = new WikiStore(adapter);
  const schemaStore = new SchemaStore(adapter);

  // 4. Initialize directories
  const dirInit = new DirectoryInit(config.watchDir);
  await dirInit.initialize();

  // 5. Initialize processing pipeline
  const pipeline = new ProcessingPipeline(rawStore, wikiStore, dirInit);

  // 6. Start HTTP server
  const httpServer = new HttpServer(
    config.port, wikiStore, rawStore, schemaStore, pipeline,
  );
  await httpServer.start();

  // 7. Start folder watcher
  const watcher = new FolderWatcher(dirInit.getPendingPath(), pipeline);
  watcher.start();

  // 8. Process existing files
  const existingCount = await watcher.processExistingFiles();
  if (existingCount > 0) {
    logger.info(`Processed ${existingCount} existing files`);
  }

  // 9. Start MCP server if stdin is connected
  if (!process.stdin.isTTY) {
    const mcpServer = new McpServer(wikiStore, pipeline);
    mcpServer.start();
  }

  logger.info('太虚图书馆 ready!');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Shutting down...');
    watcher.stop();
    await httpServer.stop();
    await adapter.close();
    process.exit(0);
  });
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
