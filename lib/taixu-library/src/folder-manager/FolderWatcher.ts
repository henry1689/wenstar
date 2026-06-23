/**
 * FolderWatcher — 外挂文件夹监控
 *
 * 使用 fs.watch 监控待处理素材目录。
 * 支持 2 秒防抖，等待文件写入完成后再处理。
 */

import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import type { ProcessingPipeline } from './SyncManager.js';

export class FolderWatcher {
  private watcher: FSWatcher | null = null;
  private processingQueue: Set<string> = new Set();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isPaused: boolean = false;

  constructor(
    private watchPath: string,
    private pipeline: ProcessingPipeline,
  ) {}

  start(): void {
    logger.info(`Watching folder: ${this.watchPath}`);
    this.watcher = watch(this.watchPath, (_eventType, fileName) => {
      if (!fileName || fileName.startsWith('.') || this.isPaused) return;
      this.debounceProcess(fileName);
    });
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.processingQueue.clear();
    logger.info('Folder watcher stopped');
  }

  pause(): void {
    this.isPaused = true;
    logger.info('Folder watcher paused');
  }

  resume(): void {
    this.isPaused = false;
    logger.info('Folder watcher resumed');
  }

  async processExistingFiles(): Promise<number> {
    const { readdir, stat } = await import('node:fs/promises');
    const files = await readdir(this.watchPath);
    let count = 0;

    for (const file of files) {
      if (file.startsWith('.')) continue;
      const filePath = join(this.watchPath, file);
      try {
        const stats = await stat(filePath);
        if (stats.isFile()) {
          await this.pipeline.processFile(filePath);
          count++;
        }
      } catch (err) {
        logger.warn(`Failed to process existing file ${file}:`, err);
      }
    }

    return count;
  }

  private debounceProcess(fileName: string): void {
    const existing = this.debounceTimers.get(fileName);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(fileName, setTimeout(async () => {
      this.debounceTimers.delete(fileName);
      await this.processFile(fileName);
    }, 2000));
  }

  private async processFile(fileName: string): Promise<void> {
    if (this.processingQueue.has(fileName)) return;
    this.processingQueue.add(fileName);

    try {
      const filePath = join(this.watchPath, fileName);
      await this.pipeline.processFile(filePath);
    } catch (err) {
      logger.error(`Failed to process ${fileName}:`, err);
    } finally {
      this.processingQueue.delete(fileName);
    }
  }
}
