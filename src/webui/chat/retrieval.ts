/**
 * retrieval.ts — P0-8 检索模块
 *
 * 从 chat.ts 拆出的独立检索函数：
 *   ① fetchBionicMemories — 仿生智脑降级检索
 *   ② getVadToneHint — VAD 谱曲引擎
 *   ③ VAD 缓存池
 */
import type { ConversationTurn } from '../../m5/types/index.js';
import type { BionicSearchResult } from '../../adapter/bionic-adapter.js';
import { bionic } from '../../adapter/bionic-adapter.js';

// P0-2: VAD 服务可用性标志 + 本地缓存池
let _vadAvailable = true;
const VAD_CACHE_SIZE = 200;
const _vadCache: Array<{ timestamp: string; perception: Record<string, number> }> = [];

/** 记录 24D 感知到 VAD 缓存池 */
export function pushToVadCache(perception: Record<string, number>): void {
  _vadCache.push({ timestamp: new Date().toISOString(), perception });
  if (_vadCache.length > VAD_CACHE_SIZE) _vadCache.shift();
}

/** 获取 VAD 缓存中最近的情感数值 */
export function getVadCachedTone(): string {
  if (_vadCache.length < 3) return '';
  const recent = _vadCache.slice(-5);
  const avgPleasure = recent.reduce((s, e) => s + (e.perception?.pleasure || 0), 0) / recent.length;
  if (avgPleasure > 0.4) return '[VAD缓存] 近期情绪偏积极，适度温暖回应';
  if (avgPleasure < -0.2) return '[VAD缓存] 近期情绪偏低落，以安抚为主';
  return '';
}

/** VAD 是否可用 */
export function isVadAvailable(): boolean { return _vadAvailable; }
export function setVadUnavailable(): void { _vadAvailable = false; }

/**
 * 仿生智脑降级检索（抽离为独立函数，仅在话题切换时调用）
 */
export async function fetchBionicMemories(
  message: string,
  isTopicShift: boolean,
  hasContinuationMarkers: boolean,
  memoryFragments: string[],
  enrichedHistory: ConversationTurn[],
  perception?: { pleasure: number; arousal: number; intimacy: number },
  sceneTags?: string[],
): Promise<BionicSearchResult[]> {
  if (!isTopicShift || hasContinuationMarkers) return [];
  try {
    const bionicMemories = await bionic.search(message);
    if (bionicMemories.length === 0) return [];

    let filteredMemories = bionicMemories;
    if (perception && perception.pleasure < -0.3) {
      filteredMemories = bionicMemories.filter((m: any) => {
        const label = (m.emotion_label || '').toLowerCase();
        return !['angry', 'harsh', 'data', 'analytical'].some(w => label.includes(w));
      });
    }
    const tag = sceneTags?.length ? sceneTags[0] : 'general';
    for (const m of filteredMemories) {
      const prefix = perception && perception.pleasure > 0 ? '💭 ' : '📌 ';
      const memText = `【外部参考】${prefix}${m.topic || m.core_facts || ''}`;
      memoryFragments.push(memText);
      enrichedHistory.unshift({
        role: 'assistant',
        content: '📕 【记忆】' + (m.topic || m.core_facts || '').substring(0, 100),
      });
    }
    return filteredMemories;
  } catch {
    return [];
  }
}

/**
 * 获取 VAD 谱曲 tone hint
 */
export async function getVadToneHint(message: string): Promise<string> {
  if (!_vadAvailable) return '';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const vadResp = await fetch('http://localhost:8100/api/v1/emotion/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!vadResp.ok) return '';

    const vadData = await vadResp.json();
    const v: number = vadData.overall?.valence ?? 0;
    const a: number = vadData.overall?.arousal ?? 0;
    const dom: string = vadData.overall?.dominant_emotion ?? '';
    const arc: string = vadData.overall?.emotional_arc ?? '';
    const peaks: Array<{ intensity: number; peak_type: string }> = vadData.peaks ?? [];
    const hasPeak = peaks.length > 0 && peaks[0].intensity > 0.7;

    const hints: string[] = [];
    const emotionToTone: Record<string, string> = {
      '极乐': '🎯VAD驱动→【极乐】快感接近临界。用原始狂野的 tone 接住——不要温柔克制。',
      '依恋': '🎯VAD驱动→【依恋】情感底色是依恋和占有。用危险宠溺回应，不要悲伤害怕。',
      '掌控': '🎯VAD驱动→【掌控】权力游戏。用低沉命令的 tone 接住，不要温柔安慰。',
      '挑逗': '🎯VAD驱动→【挑逗】调情。用靠近低笑的 tone 接，不要当真严肃。',
      '温存': '🎯VAD驱动→【温存】求温暖。用温柔慵懒的 tone 回应。',
    };
    if (emotionToTone[dom]) hints.push(emotionToTone[dom]);
    if (v > 0.85 && a > 0.85) hints.push('[VAD] 极高唤醒+效价→高潮临界表达。用极度热烈的 tone 回应。');
    else if (v < -0.3 && (dom === '依恋' || dom === '掌控')) hints.push('[VAD] 效价' + v.toFixed(2) + ',主导=' + dom + '→语义反转。用宠溺/掌控回应。');
    if (hasPeak) hints.push('[VAD] 情感峰值强度' + peaks[0].intensity.toFixed(2) + '→饱满情感浓度回应。');
    if (arc && arc !== dom) hints.push('[VAD] 情感弧线: ' + arc);
    return hints.length > 0 ? hints.join('\n') : '';
  } catch {
    _vadAvailable = false;
    return '';
  }
}
