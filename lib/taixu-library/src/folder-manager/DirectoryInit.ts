/**
 * DirectoryInit — 四层目录初始化
 *
 * 首次启动时创建标准目录结构。
 */

import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';
import { WATCH_DIRS } from './types.js';

export class DirectoryInit {
  constructor(private basePath: string) {}

  async initialize(): Promise<void> {
    for (const dir of WATCH_DIRS) {
      const fullPath = join(this.basePath, dir.path);
      await mkdir(fullPath, { recursive: true });
    }

    // Create .gitkeep in each leaf directory
    for (const dir of WATCH_DIRS) {
      const gitkeepPath = join(this.basePath, dir.path, '.gitkeep');
      try {
        await access(gitkeepPath);
      } catch {
        await writeFile(gitkeepPath, '');
      }
    }

    logger.info(`Library directories initialized at: ${this.basePath}`);
  }

  getPendingPath(): string {
    return join(this.basePath, '01_待处理素材');
  }

  getOutputPath(): string {
    return join(this.basePath, '02_知识笔记库');
  }

  getArchivePath(): string {
    return join(this.basePath, '03_原始附件归档');
  }

  getTrashPath(): string {
    return join(this.basePath, '04_回收站');
  }
}
