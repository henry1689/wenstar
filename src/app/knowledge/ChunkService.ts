/**
 * ChunkService — 文本分块服务
 *
 * 按最大字数（默认 512）将文本切分为块，块间带重叠（默认 64 字）。
 * 纯字符串操作，零依赖。
 */

export interface Chunk {
  index: number;
  text: string;
}

/**
 * 将长文本切分成块
 * @param text  原始文本
 * @param maxLen  每块最大字符数（默认 512）
 * @param overlap 块间重叠字符数（默认 64）
 */
export function chunkText(text: string, maxLen = 512, overlap = 64): Chunk[] {
  if (!text || text.length === 0) return [];
  if (text.length <= maxLen) return [{ index: 0, text }];

  const chunks: Chunk[] = [];
  const step = maxLen - overlap;
  let start = 0;
  let idx = 0;

  while (start < text.length) {
    const end = Math.min(start + maxLen, text.length);
    chunks.push({ index: idx++, text: text.slice(start, end) });
    start += step;

    // 防止最后一段过短（小于 overlap 的一半则合并到前一块）
    if (text.length - start < overlap / 2 && start < text.length) {
      // 不处理了，上一块已经覆盖到最后
      break;
    }
  }

  return chunks;
}
