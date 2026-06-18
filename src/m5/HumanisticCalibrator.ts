/**
 * M5 Step 4: 人文校准 — 校验 + 降级兜底
 * Ref: M5-design-v1.md §5
 *
 * 最近回复池：记录最近 20 条回复，防止完全相同的句子重复出现。
 */
import type { CognitionObject } from './types/index.js';
import type { M3Action } from '../m3/types/perception.js';
import { injectThinkingPause } from './expression/ThinkingPauseInjector.js';
import { fixSceneConflict as fixContextConflict } from './ContextMemory.js';

const FALLBACK_POOLS: Record<M3Action, string[]> = {
  ignore: ['嗯', '好的', '听到了', '嗯嗯', '好嘞', '知道啦', '明白'],
  memorize: ['我记住了', '好的，我记下了', '收到，记在心里了', '嗯，我记住了', '好的，不会忘的'],
  ask: ['能多说说吗？我想了解更多', '这很有趣，可以说详细点吗？', '然后呢？我想听下去', '真的吗？跟我说说', '好奇了，快讲讲'],
  comfort: ['我在这里陪着你', '没关系的，我理解', '我在呢，别怕', '有我在，不怕', '我陪着你的'],
  act: ['我在', '好的，收到', '来了', '知道了', '明白'],
};

const RECENT_POOL: string[] = [];
const MAX_RECENT = 20;

function getUniqueFallback(action: M3Action): string {
  const pool = FALLBACK_POOLS[action] ?? FALLBACK_POOLS.memorize;
  // 找一条不在最近池里的
  const candidates = pool.filter(r => !RECENT_POOL.includes(r));
  const chosen = candidates.length > 0
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : pool[Math.floor(Math.random() * pool.length)];
  RECENT_POOL.push(chosen);
  if (RECENT_POOL.length > MAX_RECENT) RECENT_POOL.shift();
  return chosen;
}

export class HumanisticCalibrator {
  /**
   * 三维融合度检查：校验回复是否同时覆盖了情绪承接和核心解答
   * @param reply 生成的回复文本
   * @param knowledgeBase 输入的知识库文本（含【情绪承接】【核心解答】等标记）
   * @returns { isPass: boolean; reason?: string }
   */
  static checkFusion(reply: string, knowledgeBase?: string): { isPass: boolean; reason?: string } {
    if (!reply || reply.length < 10) return { isPass: false, reason: '回复过短' };
    if (!knowledgeBase) return { isPass: true }; // 无知识库不校验

    const hasEmotionTag = knowledgeBase.includes('【情绪承接】');
    const hasAnswerTag = knowledgeBase.includes('【核心解答】');
    if (!hasEmotionTag && !hasAnswerTag) return { isPass: true }; // 无段落标记不校验

    // 检查回复中是否覆盖了两种内容
    const replyLower = reply.toLowerCase();
    const hasEmotion = hasEmotionTag
      ? /累|辛苦|委屈|难受|心疼|别急|没事|放心|理解|抱|懂|陪|在/.test(replyLower)
      : true;
    const hasAnswer = hasAnswerTag
      ? reply.length > 20 && /是|可以|应该|因为|所以|建议|要|会|能/.test(replyLower)
      : true;

    if (hasEmotionTag && !hasEmotion) {
      return { isPass: false, reason: '知识库含情绪承接内容但回复中缺少情绪承接' };
    }
    if (hasAnswerTag && !hasAnswer) {
      return { isPass: false, reason: '知识库含核心解答内容但回复中缺少解答' };
    }
    return { isPass: true };
  }

  calibrate(draft: string, cognition: CognitionObject): string {
    // 校验1: 空校验
    if (!draft || draft.trim().length === 0) {
      return getUniqueFallback(cognition.current.action[0] ?? 'memorize');
    }

    // 校验2: 【五重铁律·完美剥离协议】不修复任何"错误"，包括标点

    // 校验3: 检查最近 20 条中是否有完全相同的回复
    if (RECENT_POOL.includes(draft)) {
      const prefix = ['', '嗯 ', '好 ', '嗯嗯，'][Math.floor(Math.random() * 4)];
      if (prefix) draft = prefix + draft;
    }

    // ── ThinkingPauseInjector 激活：根据钙化等级注入思考停顿 ──
    const level = cognition.current.calcium_level ?? 1;
    const intensity = level >= 3 ? 0.7 : level >= 2 ? 0.45 : level >= 1 ? 0.2 : 0;
    if (intensity > 0) {
      draft = injectThinkingPause(draft, intensity);
    }

    // ── 场景一致性修正：全裸时移除"衣角""扣子"等矛盾词 ──
    draft = fixContextConflict(draft);

    // 记录到最近池
    RECENT_POOL.push(draft);
    if (RECENT_POOL.length > MAX_RECENT) RECENT_POOL.shift();

    return draft;
  }
}
