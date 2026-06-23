/**
 * ParserFactory — 解析器工厂
 *
 * 根据文件扩展名选择对应的解析器。
 * 不支持的格式抛出 UnsupportedFormatError。
 */

import * as path from 'node:path';

export interface ParsedResult {
  content: string;
  title?: string;
  metadata?: Record<string, string>;
  images?: string[];
}

export interface FileParser {
  parse(filePath: string): Promise<ParsedResult>;
}

export class UnsupportedFormatError extends Error {
  constructor(ext: string) {
    super(`Unsupported file format: ${ext}`);
    this.name = 'UnsupportedFormatError';
  }
}

export class ParserFactory {
  static async getParser(filePath: string): Promise<FileParser> {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.txt':
      case '.md':
      case '.markdown': {
        const { TextParser } = await import('./TextParser.js');
        return new TextParser();
      }
      case '.docx': {
        const { DocxParser } = await import('./DocxParser.js');
        return new DocxParser();
      }
      case '.pdf': {
        const { PdfParser } = await import('./PdfParser.js');
        return new PdfParser();
      }
      case '.jpg':
      case '.jpeg':
      case '.png':
      case '.bmp':
      case '.webp':
      case '.gif': {
        const { ImageParser } = await import('./ImageParser.js');
        return new ImageParser();
      }
      default:
        throw new UnsupportedFormatError(ext);
    }
  }

  static getSupportedExtensions(): string[] {
    return ['.txt', '.md', '.markdown', '.docx', '.pdf',
      '.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif'];
  }
}
