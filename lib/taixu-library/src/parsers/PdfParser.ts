/**
 * PdfParser — PDF 文件解析器
 *
 * 使用 pdf-parse 提取文本内容。
 * 扫描版 PDF（无文本层）返回提示信息，不崩溃。
 */

import { readFile } from 'node:fs/promises';
import type { ParsedResult, FileParser } from './ParserFactory.js';

// pdf-parse has no type declarations
interface PdfParseResult {
  text?: string;
  numpages?: number;
  title?: string;
  author?: string;
}

export class PdfParser implements FileParser {
  async parse(filePath: string): Promise<ParsedResult> {
    const buffer = await readFile(filePath);

    const pdfParse: any = await import('pdf-parse');
    const data = await pdfParse.default(buffer) as PdfParseResult;

    const content = data.text?.trim() || '';
    if (!content) {
      return {
        content: '',
        title: filePath.replace(/.*[/\\]/, '').replace(/\.pdf$/i, ''),
        metadata: { warning: '扫描版PDF或无可提取文本，建议使用OCR' },
      };
    }

    return {
      content,
      title: (data as any).title || filePath.replace(/.*[/\\]/, '').replace(/\.pdf$/i, ''),
      metadata: {
        pages: String(data.numpages || 0),
        author: (data as any).author || '',
      },
    };
  }
}
