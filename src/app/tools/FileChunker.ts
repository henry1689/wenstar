/**
 * FileChunker — 文件自动结构化切片工具类
 *
 * 职责: 将文件内容按策略切分为结构化块，便于 RAG 检索。
 *      支持纯文本、按段落、按标题结构、按固定 Token 数切片。
 *
 * 设计原则:
 *   1. 纯工具，不依赖任何业务模块
 *   2. 输入为字符串+元数据，输出为 Chunk 数组
 *   3. 多种分块策略可互换
 *   4. 支持上下文重叠（overlap）
 *   5. 保留原始结构标记（标题层级/段落号）
 *
 * 用法:
 *   const chunker = new FileChunker({ strategy: 'paragraph', chunkSize: 500, overlap: 50 });
 *   const chunks = chunker.chunk(text, { source: 'manual.pdf' });
 */

// ─── 类型 ───

export type ChunkStrategy = 'paragraph' | 'heading' | 'fixed' | 'line';

export interface FileChunkerOptions {
  /** 分块策略，默认 'paragraph' */
  strategy?: ChunkStrategy;
  /** 目标块大小（按字符数），默认 500 */
  chunkSize?: number;
  /** 块间重叠字符数，默认 50 */
  overlap?: number;
  /** 最少块字符数（小于此值的块丢弃），默认 20 */
  minChunkLen?: number;
  /** 最大块字符数（超此值强制拆分），默认 2000 */
  maxChunkLen?: number;
}

export interface Chunk {
  /** 块序号（从 0 开始） */
  index: number;
  /** 块文本内容 */
  content: string;
  /** 字符数 */
  length: number;
  /** 来源文件 */
  source: string;
  /** 原始文件内的位置偏移（字符数，从 0 开始） */
  offset: number;
  /** 标题/分段标记（如有） */
  heading?: string;
  /** 元数据（可扩展） */
  metadata?: Record<string, any>;
}

export interface ChunkInput {
  /** 文件内容 */
  text: string;
  /** 来源标识（文件名/路径） */
  source: string;
  /** 可选的标题/章节分层 */
  structure?: Array<{ heading: string; startLine: number }>;
  /** 附加元数据 */
  metadata?: Record<string, any>;
}

// ─── 工具类 ───

export class FileChunker {
  private strategy: ChunkStrategy;
  private chunkSize: number;
  private overlap: number;
  private minChunkLen: number;
  private maxChunkLen: number;

  constructor(options: FileChunkerOptions = {}) {
    this.strategy = options.strategy ?? 'paragraph';
    this.chunkSize = options.chunkSize ?? 500;
    this.overlap = options.overlap ?? 50;
    this.minChunkLen = options.minChunkLen ?? 20;
    this.maxChunkLen = options.maxChunkLen ?? 2000;
  }

  // ─── 公开方法 ───

  /**
   * 对输入文本执行分块
   * @param input 输入内容
   * @returns Chunk 数组
   */
  chunk(input: ChunkInput): Chunk[] {
    const { text, source, metadata } = input;

    switch (this.strategy) {
      case 'paragraph':
        return this.chunkByParagraph(text, source, metadata);
      case 'heading':
        return this.chunkByHeading(text, source, input.structure, metadata);
      case 'fixed':
        return this.chunkByFixedSize(text, source, metadata);
      case 'line':
        return this.chunkByLine(text, source, metadata);
      default:
        return this.chunkByParagraph(text, source, metadata);
    }
  }

  /**
   * 分块 + 过滤短块 + 统计摘要
   */
  chunkWithSummary(input: ChunkInput): { chunks: Chunk[]; totalChars: number; chunkCount: number } {
    const chunks = this.chunk(input);
    const filtered = chunks.filter(c => c.length >= this.minChunkLen);
    return {
      chunks: filtered,
      totalChars: input.text.length,
      chunkCount: filtered.length,
    };
  }

  // ─── 分块策略 ───

  /** 按段落分块（连续空行分割） */
  private chunkByParagraph(text: string, source: string, metadata?: Record<string, any>): Chunk[] {
    const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return this.mergeSmallChunks(paragraphs, source, metadata);
  }

  /** 按标题结构分块（Markdown 标题 `# ` / `## ` 等） */
  private chunkByHeading(text: string, source: string, structure?: ChunkInput['structure'], metadata?: Record<string, any>): Chunk[] {
    const lines = text.split('\n');
    const chunks: string[] = [];
    let current: string[] = [];
    let currentHeading = '';

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
      if (headingMatch) {
        if (current.length > 0) {
          chunks.push((currentHeading ? `【${currentHeading}】\n` : '') + current.join('\n'));
        }
        currentHeading = headingMatch[2];
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) {
      chunks.push((currentHeading ? `【${currentHeading}】\n` : '') + current.join('\n'));
    }

    return this.mergeSmallChunks(chunks, source, metadata);
  }

  /** 按固定字符数分块（带重叠） */
  private chunkByFixedSize(text: string, source: string, metadata?: Record<string, any>): Chunk[] {
    const chunks: Chunk[] = [];
    let start = 0;
    let index = 0;

    while (start < text.length) {
      let end = Math.min(start + this.chunkSize, text.length);

      // 尽量在句子边界断开（找最近的句号/换行）
      if (end < text.length) {
        const boundary = this.findBoundary(text, end, this.overlap);
        end = boundary;
      }

      const content = text.substring(start, end).trim();
      if (content.length >= this.minChunkLen) {
        chunks.push({
          index: index++,
          content,
          length: content.length,
          source,
          offset: start,
          metadata,
        });
      }

      start = end - this.overlap;
    }

    return chunks;
  }

  /** 按行分块（每行一块） */
  private chunkByLine(text: string, source: string, metadata?: Record<string, any>): Chunk[] {
    return text.split('\n')
      .map((line, i) => line.trim())
      .filter(line => line.length >= this.minChunkLen)
      .map((line, i) => ({
        index: i,
        content: line,
        length: line.length,
        source,
        offset: 0,
        metadata,
      }));
  }

  // ─── 辅助方法 ───

  /** 合并小段落为满足 chunkSize 的块 */
  private mergeSmallChunks(segments: string[], source: string, metadata?: Record<string, any>): Chunk[] {
    const result: Chunk[] = [];
    let buffer = '';
    let bufferOffset = 0;
    let index = 0;
    let charOffset = 0;

    for (const seg of segments) {
      if (seg.length > this.maxChunkLen) {
        // 超大段落：先 flush 缓存，再独立拆分
        if (buffer) {
          result.push({ index: index++, content: buffer.trim(), length: buffer.trim().length, source, offset: bufferOffset, metadata });
          buffer = '';
        }
        const subChunks = this.chunkByFixedSize(seg, source, metadata);
        result.push(...subChunks.map((c, i) => ({ ...c, index: index++ })));
        charOffset += seg.length;
        continue;
      }

      if (buffer.length + seg.length > this.chunkSize && buffer.length >= this.minChunkLen) {
        result.push({ index: index++, content: buffer.trim(), length: buffer.trim().length, source, offset: bufferOffset, metadata });
        // 重叠：保留末尾 overlap 字符
        buffer = buffer.substring(buffer.length - this.overlap) + '\n\n' + seg;
        bufferOffset = charOffset - this.overlap;
      } else {
        if (!buffer) bufferOffset = charOffset;
        buffer += (buffer ? '\n\n' : '') + seg;
      }
      charOffset += seg.length;
    }

    if (buffer.trim().length >= this.minChunkLen) {
      result.push({ index: index++, content: buffer.trim(), length: buffer.trim().length, source, offset: bufferOffset, metadata });
    }

    return result;
  }

  /** 在指定位置附近找句子边界 */
  private findBoundary(text: string, fromPos: number, lookBackChars: number): number {
    const start = Math.max(0, fromPos - lookBackChars);
    const snippet = text.substring(start, fromPos + 50);

    // 优先找句号/问号/感叹号 + 换行
    const re = /[。！？\n][」』]?/g;
    let match;
    let best = fromPos;

    while ((match = re.exec(snippet)) !== null) {
      const pos = start + match.index + match[0].length;
      if (pos <= fromPos + 10 && pos >= fromPos - lookBackChars) {
        best = pos;
      }
      if (pos > fromPos) break;
    }

    return best;
  }
}
