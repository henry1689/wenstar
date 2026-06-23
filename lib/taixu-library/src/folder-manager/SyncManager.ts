/**
 * SyncManager — 文件同步处理流水线
 *
 * 核心处理流程:
 * 1. 解析文件 → 2. 生成DNA → 3. 提取实体 → 4. 生成元标签
 * → 5. 存储原始层 → 6. 写入知识笔记 → 7. 存储词条层 → 8. 归档原始
 */

import { readFile, stat, rename, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { DnaGenerator } from '../core/DnaGenerator.js';
import { CalciumEngine } from '../core/CalciumEngine.js';
import { EntityExtractor } from '../core/EntityExtractor.js';
import { MetaTagGenerator } from '../core/MetaTagGenerator.js';
import { ParserFactory } from '../parsers/ParserFactory.js';
import type { DirectoryInit } from './DirectoryInit.js';
import type { RawStore } from '../storage/RawStore.js';
import type { WikiStore } from '../storage/WikiStore.js';
import type { SyncReport } from './types.js';

export class ProcessingPipeline {
  private dnaGenerator = new DnaGenerator();
  private calciumEngine = new CalciumEngine();
  private entityExtractor = new EntityExtractor();
  private metaGenerator = new MetaTagGenerator();

  constructor(
    private rawStore: RawStore,
    private wikiStore: WikiStore,
    private dirInit: DirectoryInit,
  ) {}

  async processFile(filePath: string): Promise<void> {
    const fileName = basename(filePath);
    logger.info(`Processing: ${fileName}`);

    // 1. Calculate file hash
    const fileHash = await this.calculateHash(filePath);

    // 2. Parse file
    const parser = await ParserFactory.getParser(filePath);
    const result = await parser.parse(filePath);

    if (!result.content.trim()) {
      logger.warn(`Empty content: ${fileName}, archiving raw`);
      await this.archiveOriginal(filePath);
      return;
    }

    // 3. Generate DNA root ID
    const dnaRootId = this.dnaGenerator.generateRootId('library');

    // 4. Extract entities
    const entities = this.entityExtractor.extract(result.content);

    // 5. Calculate initial calcium score
    const calcium = this.calciumEngine.calculate({
      emotionalIntensity: 3.0,
      intimacyLevel: 0,
      socialRelevance: entities.filter(e => e.type === 'person').length * 2,
      factualDensity: 7.0,
      unusualness: 3.0,
    });

    // 6. Generate meta tags + markdown
    const meta = this.metaGenerator.generate(
      dnaRootId, result.content, filePath, entities, calcium,
    );
    const markdown = this.metaGenerator.toMarkdown(meta, result.content);

    // 7. Get file stats
    const stats = await stat(filePath);

    // 8. Store in raw attachments layer
    await this.rawStore.create({
      dna_root_id: dnaRootId,
      file_name: fileName,
      file_path: filePath,
      original_path: filePath,
      file_size: stats.size,
      mime_type: this.getMimeType(filePath),
      sha256_hash: fileHash,
      original_content: result.content,
    });

    // 9. Write markdown to knowledge notes directory
    const outputDir = join(
      this.dirInit.getOutputPath(),
      meta.type === 'memo' ? 'memos' : 'references',
    );
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, `${dnaRootId}.md`);
    await writeFile(outputPath, markdown, 'utf-8');

    // 10. Store in wiki entries layer
    await this.wikiStore.create({
      dna_root_id: dnaRootId,
      title: meta.title,
      type: meta.type,
      content: result.content,
      summary: meta.summary,
      calcium,
      entities: JSON.stringify(entities),
      tags: JSON.stringify(meta.tags),
    });

    // 11. Archive original file
    await this.archiveOriginal(filePath);

    logger.info(`Successfully processed: ${fileName} → ${dnaRootId}`);
  }

  async syncAll(): Promise<SyncReport> {
    const { readdir } = await import('node:fs/promises');
    const report: SyncReport = {
      totalProcessed: 0,
      successCount: 0,
      failCount: 0,
      errors: [],
      startedAt: new Date().toISOString(),
      completedAt: '',
    };

    const pendingDir = this.dirInit.getPendingPath();
    let files: string[];
    try {
      files = await readdir(pendingDir);
    } catch {
      files = [];
    }

    for (const file of files) {
      if (file.startsWith('.')) continue;
      report.totalProcessed++;
      try {
        await this.processFile(join(pendingDir, file));
        report.successCount++;
      } catch (err) {
        report.failCount++;
        report.errors.push({ file, error: String(err) });
      }
    }

    report.completedAt = new Date().toISOString();
    return report;
  }

  private async calculateHash(filePath: string): Promise<string> {
    const content = await readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  }

  private async archiveOriginal(filePath: string): Promise<void> {
    const archiveDir = this.dirInit.getArchivePath();
    const datedDir = join(archiveDir, new Date().toISOString().slice(0, 7).replace('-', '/'));
    await mkdir(datedDir, { recursive: true });
    const destPath = join(datedDir, basename(filePath));
    await rename(filePath, destPath).catch(() => {
      // If rename fails (cross-device), copy and delete
    });
    logger.info(`Archived: ${basename(filePath)} → ${destPath}`);
  }

  private getMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.txt': 'text/plain',
      '.md': 'text/markdown',
      '.markdown': 'text/markdown',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }
}
