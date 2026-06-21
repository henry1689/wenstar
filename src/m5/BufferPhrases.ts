/**
 * BufferPhrases — P1-3 过渡话术语料库
 *
 * 当检索/计算耗时较长时，M5 自动插入自然过渡语句，
 * 避免沉默等待，让对话更自然。
 *
 * 按场景分类，随机选择，避免机械重复。
 */
export interface BufferContext {
  /** 当前对话模式 */
  mode: 'memory_recall' | 'vague_recall' | 'knowledge_query' | 'intimate' | 'casual' | 'work';
  /** 已耗时毫秒 */
  elapsedMs: number;
}

// ─── 回忆类过渡 ───

const RECALL_PHRASES = [
  '让我想想……',
  '嗯…我回忆一下……',
  '我记得一些，让我理一理……',
  '你说的事我有点印象，我翻翻记忆……',
  '等等啊，我回想一下……',
];

const VAGUE_RECALL_PHRASES = [
  '你说的这个…我好像在哪听过……',
  '让我好好想想……',
  '嗯…有点模糊的印象，我仔细回忆一下……',
];

// ─── 知识类过渡 ───

const KNOWLEDGE_PHRASES = [
  '这个我之前了解过一些，我梳理一下……',
  '好问题，我整理一下我知道的信息……',
  '让我把相关的信息理清楚……',
];

// ─── 军师/分析类过渡 ───

const WORK_PHRASES = [
  '我分析了一下情况……',
  '综合你之前说的，我整理出几点……',
  '让我把这个思路理清楚……',
];

// ─── 亲密类过渡 ───

const INTIMATE_PHRASES = [
  '嗯…你让我想想……',
  '这些话我只想对你说……',
];

const CASUAL_PHRASES = [
  '嗯……',
  '我想想啊……',
];

const PHRASE_MAP: Record<string, string[]> = {
  memory_recall: RECALL_PHRASES,
  vague_recall: VAGUE_RECALL_PHRASES,
  knowledge_query: KNOWLEDGE_PHRASES,
  intimate: INTIMATE_PHRASES,
  work: WORK_PHRASES,
  casual: CASUAL_PHRASES,
};

function pick(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 根据场景获取自然过渡话术
 * @param context 当前对话上下文
 * @returns 过渡话术字符串（空字符串表示不需要过渡）
 */
export function getBufferPhrase(context: BufferContext): string {
  const { mode, elapsedMs } = context;

  // 耗时不足 500ms 不需要过渡
  if (elapsedMs < 500) return '';

  // 根据模式选择语料库
  const pool = PHRASE_MAP[mode] || PHRASE_MAP.casual;
  const phrase = pick(pool);

  // 长耗时（>2s）加长版过渡
  if (elapsedMs > 2000) {
    const longVersions: Record<string, string[]> = {
      memory_recall: ['你让我想想，我好好回忆一下之前的细节……', '这件事我记得一些，让我把前因后果理清楚……'],
      knowledge_query: ['这个问题我需要查一下我知道的信息，我整理一下思路……', '让我把所有相关信息都过一遍，给你一个完整的分析……'],
    };
    const longPool = longVersions[mode];
    if (longPool) return pick(longPool);
  }

  return phrase;
}
