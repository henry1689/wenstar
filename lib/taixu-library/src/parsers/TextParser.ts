/**
 * TextParser — 纯文本/Markdown 文件解析器
 *
 * 支持 .txt 和 .md 文件。
 * .md 文件会尝试提取 YAML front-matter。
 */

import { readFile } from 'node:fs/promises';
import type { ParsedResult, FileParser } from './ParserFactory.js';

export class TextParser implements FileParser {
  async parse(filePath: string): Promise<ParsedResult> {
    const raw = await readFile(filePath, 'utf-8');
    const ext = filePath.toLowerCase();

    if (ext.endsWith('.md')) {
      return this.parseMarkdown(raw, filePath);
    }
    return {
      content: raw,
      title: this.guessTitle(raw),
    };
  }

  private parseMarkdown(raw: string, _filePath: string): ParsedResult {
    // Try to extract YAML front-matter
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    let content = raw;
    const metadata: Record<string, string> = {};

    if (fmMatch) {
      const yamlBlock = fmMatch[1];
      content = fmMatch[2].trim();

      // Parse simple YAML key-value pairs
      for (const line of yamlBlock.split('\n')) {
        const kv = line.match(/^(\w[\w_]*):\s*(.+)$/);
        if (kv) {
          metadata[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
        }
      }
    }

    return {
      content,
      title: metadata.title || this.guessTitle(raw),
      metadata,
    };
  }

  private guessTitle(raw: string): string {
    const firstLine = raw.split('\n')[0]?.trim();
    if (firstLine && firstLine.length < 100) {
      return firstLine.replace(/^#+\s*/, '');
    }
    return 'untitled';
  }
}
