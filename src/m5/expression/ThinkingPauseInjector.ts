// ThinkingPauseInjector — 0.6秒思考停顿注入器
// 高强度场景下，在文本中插入"带思考动作的停顿"，
// 模拟"边想边说"的真实感，替代单纯的省略号

// 不同强度的停顿标记池
const PAUSES: Record<string, string[]> = {
  light: [
    '…',
    '…（想了想）',
    '——',
  ],
  medium: [
    '…（停顿了一下）',
    '——（好像在斟酌用词）',
    '…（语气放缓了些）',
  ],
  heavy: [
    '…（顿了顿，像是在回味）',
    '——（呼吸轻了些）',
    '…（想了很久才开口）',
    '——（声音不自觉地放轻了）',
    '…（好像被那个画面触动到了）',
  ],
};

// 拟声词/语气词开关（短回应中使用）
const VOCAL_TICS = ['嗯…', '唔…', '诶…', '哈…'];

/**
 * 根据强度在文本中插入思考停顿
 *
 * @param text 原始文本
 * @param intensity 强度 (0-1)
 * @param wordCount 目标字数
 * @returns 插入停顿后的文本
 */
export function injectThinkingPause(text: string, intensity: number): string {
  if (intensity > 0.6) {
    // 高强度：2-3次停顿，使用 heavy 池
    const positions = [0.2, 0.5, 0.75];
    let result = text;
    let offset = 0;

    for (const pos of positions) {
      const idx = Math.floor((result.length) * pos);
      if (idx < 5 || idx > result.length - 10) continue;
      const pause = PAUSES.heavy[Math.floor(Math.random() * PAUSES.heavy.length)];
      result = result.slice(0, idx + offset) + pause + result.slice(idx + offset);
      offset += pause.length;
    }

    // 开头加语气词
    const tic = VOCAL_TICS[Math.floor(Math.random() * VOCAL_TICS.length)];
    if (Math.random() > 0.5) {
      result = tic + result;
    }

    return result;
  }

  if (intensity > 0.3) {
    // 中强度：1次停顿
    const positions = [0.4];
    let result = text;
    let offset = 0;
    for (const pos of positions) {
      const idx = Math.floor(result.length * pos);
      const pause = PAUSES.medium[Math.floor(Math.random() * PAUSES.medium.length)];
      result = result.slice(0, idx + offset) + pause + result.slice(idx + offset);
      offset += pause.length;
    }
    return result;
  }

  // 低强度：无停顿或简单省略号
  return text.replace(/[。，]$/, '…');
}

/**
 * 为短回应注入语气前缀
 */
export function injectVocalTic(text: string, intensity: number): string {
  if (intensity > 0.5 && Math.random() > 0.4) {
    const tic = VOCAL_TICS[Math.floor(Math.random() * VOCAL_TICS.length)];
    return tic + text;
  }
  return text;
}
