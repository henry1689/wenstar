/**
 * MetaTagGenerator — YAML 元标签生成器
 *
 * 生成与主程序 100% 兼容的 YAML front-matter + Markdown。
 * 零外部依赖。
 */

import { createHash } from 'node:crypto';
import type { ExtractedEntity } from './EntityExtractor.js';

export interface MetaTags {
  dna_root_id: string;
  title: string;
  type: 'memo' | 'reference' | 'note' | 'article';
  calcium: number;
  entities: Array<{ name: string; type: string }>;
  tags: string[];
  summary: string;
  source: string;
  original_hash: string;
  created_at: string;
  updated_at: string;
}

export class MetaTagGenerator {
  generate(
    dnaRootId: string,
    content: string,
    source: string,
    entities: ExtractedEntity[],
    calcium: number,
  ): MetaTags {
    return {
      dna_root_id: dnaRootId,
      title: this.extractTitle(content, source),
      type: this.inferType(source),
      calcium,
      entities: entities.map(e => ({ name: e.name, type: e.type })),
      tags: this.generateTags(content, entities),
      summary: this.generateSummary(content),
      source,
      original_hash: this.sha256(content),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  /** 输出为 YAML front-matter + markdown */
  toMarkdown(meta: MetaTags, body: string): string {
    const yamlLines: string[] = [
      '---',
      `dna_root_id: ${meta.dna_root_id}`,
      `title: ${meta.title}`,
      `type: ${meta.type}`,
      `calcium: ${meta.calcium}`,
      'entities:',
    ];

    for (const e of meta.entities) {
      yamlLines.push(`  - name: ${e.name}`);
      yamlLines.push(`    type: ${e.type}`);
    }

    yamlLines.push('tags:');
    for (const t of meta.tags) {
      yamlLines.push(`  - ${t}`);
    }

    yamlLines.push(
      `summary: ${meta.summary}`,
      `source: ${meta.source}`,
      `original_hash: ${meta.original_hash}`,
      `created_at: ${meta.created_at}`,
      `updated_at: ${meta.updated_at}`,
      '---',
      '',
      body,
    );

    return yamlLines.join('\n');
  }

  private extractTitle(content: string, source: string): string {
    // 尝试从内容首行提取标题
    const firstLine = content.split('\n')[0]?.trim();
    if (firstLine && firstLine.length < 100) {
      // 去掉可能的 markdown 标题标记
      return firstLine.replace(/^#+\s*/, '').trim();
    }
    // 后备：使用文件名
    const parts = source.replace(/\\/g, '/').split('/');
    const fileName = parts[parts.length - 1] || 'untitled';
    return fileName.replace(/\.[^.]+$/, '');
  }

  private inferType(source: string): MetaTags['type'] {
    const path = source.toLowerCase();
    if (path.includes('memo') || path.includes('备忘')) return 'memo';
    if (path.includes('reference') || path.includes('参考')) return 'reference';
    if (path.includes('article') || path.includes('文章')) return 'article';
    return 'note';
  }

  private generateTags(_content: string, entities: ExtractedEntity[]): string[] {
    const tags = new Set<string>();
    for (const e of entities) {
      if (e.type === 'person') tags.add(`人物:${e.name}`);
      if (e.type === 'place') tags.add(`地点:${e.name}`);
      if (e.type === 'concept') tags.add(e.name);
    }
    return [...tags].slice(0, 10);
  }

  private generateSummary(content: string): string {
    const cleaned = content
      .replace(/^#[#\s]+/gm, '')
      .replace(/[#*`~>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.substring(0, 200) + (cleaned.length > 200 ? '…' : '');
  }

  private sha256(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }
}
