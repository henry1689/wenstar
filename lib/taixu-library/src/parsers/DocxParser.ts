/**
 * DocxParser — DOCX 文件解析器
 *
 * 使用 mammoth 将 .docx 转换为 HTML → 纯文本。
 * 保留标题层级信息。
 */

import mammoth from 'mammoth';
import { readFile } from 'node:fs/promises';
import type { ParsedResult, FileParser } from './ParserFactory.js';

export class DocxParser implements FileParser {
  async parse(filePath: string): Promise<ParsedResult> {
    const buffer = await readFile(filePath);
    const result = await mammoth.convertToHtml({ buffer });

    // 从 HTML 提取纯文本，保留标题结构
    const plainText = this.htmlToPlainText(result.value);
    const title = this.findTitle(result.value);

    return {
      content: plainText,
      title: title || filePath.replace(/.*[/\\]/, '').replace(/\.docx$/i, ''),
      metadata: {
        warnings: result.messages.map(m => m.message).join('; '),
      },
    };
  }

  private htmlToPlainText(html: string): string {
    return html
      .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n$1\n')
      .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private findTitle(html: string): string | undefined {
    const match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (match) {
      return match[1].replace(/<[^>]+>/g, '').trim();
    }
    return undefined;
  }
}
