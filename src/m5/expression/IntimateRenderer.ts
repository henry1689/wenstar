// IntimateRenderer — 私密场景回应渲染器 v2.0
// 多感官场景组合规则:
// 前戏:  触觉+嗅觉+视觉+舌吻 (level 1)
// 激情:  触觉+私密+视觉+体声+挑逗 (level 2)
// 高潮:  失控+体声+私密+短句堆叠 (level 2/3)
// 破禁:  脏话+臣服+触觉 (level 3)
// 事后:  温存+嗅觉 (level 1)

import { getPhrases, getShortBurst, getAftercareLine, buildSensoryPassage } from './IntimateLexicon.js';
import type { SensoryDim } from './IntimateLexicon.js';
import { injectThinkingPause } from './ThinkingPauseInjector.js';

export type IntimateSceneType = 'foreplay' | 'thrust' | 'climax' | 'aftercare' | 'degradation';

export interface IntimateScene {
  intensity: number;
  sceneType: IntimateSceneType;
  userLevel: 1 | 2 | 3;
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/**
 * 渲染完整私密回应
 */
export function renderIntimateResponse(scene: IntimateScene): string {
  const { sceneType, intensity, userLevel } = scene;
  const level = userLevel;

  switch (sceneType) {
    case 'foreplay': return renderForeplay(intensity, level);
    case 'thrust': return renderThrust(intensity, level);
    case 'climax': return renderClimax(intensity, level);
    case 'aftercare': return renderAftercare();
    case 'degradation': return renderDegradation(level);
  }
}

// ─── 前戏场景 ───
function renderForeplay(intensity: number, level: 1 | 2 | 3): string {
  const sections: string[] = [];

  // 开场：微喘/视觉描写
  sections.push(pick([
    '（呼吸有点不稳，眼神暗了暗）',
    '（喉结上下滑动了一下）',
    '（声音带了一点哑）',
  ]));

  // 感官堆叠：触觉+嗅觉+视觉+舌吻
  const sensory = buildSensoryPassage(level, ['触觉', '嗅觉', '视觉', '舌吻'].slice(0, intensity > 0.5 ? 4 : 2) as SensoryDim[]);
  if (sensory) sections.push(sensory);

  // 挑逗收尾
  sections.push(getPhrases('挑逗', level, 1).join(''));

  let text = sections.filter(Boolean).join('。');
  return injectThinkingPause(text, intensity);
}

// ─── 激情操干场景 ───
function renderThrust(intensity: number, level: 1 | 2 | 3): string {
  const sections: string[] = [];

  // 开场：喘息
  sections.push(pick([
    '（喘着粗气，花了几秒才稳住声音）',
    '（深吸了一口气，声音还是有点抖）',
    '（咽了一下，喉结上下动了动）',
  ]));

  // 动作描写 (2条)
  const actions = getPhrases('动作', level, 2);
  sections.push(...actions.slice(0, 2));

  // 触觉/私密 (2条)
  const touches = getPhrases('触觉', level, 2);
  sections.push(...touches.slice(0, 2));

  // 视觉/体声 (1条)
  const sounds = getPhrases('体声', level, 1);
  if (sounds.length > 0) sections.push(sounds[0]);

  // 短句爆裂
  if (intensity > 0.5) {
    sections.push(getShortBurst());
    sections.push(getShortBurst());
  }

  // 声音 1条
  const voices = getPhrases('声音', level, 1);
  if (voices.length > 0) sections.push(voices[0]);

  let text = sections.filter(Boolean).join('。');
  return injectThinkingPause(text, Math.min(intensity + 0.2, 1));
}

// ─── 高潮场景 ───
function renderClimax(intensity: number, level: 1 | 2 | 3): string {
  const sections: string[] = [];

  // 开场：失神
  sections.push(pick([
    '（缓了好一会儿，声音还在抖）',
    '（呼吸又急又重，话都说不连贯）',
    '（整个人像刚从水里捞出来一样）',
  ]));

  // 失控感
  const loss = getPhrases('失控', level, 2);
  sections.push(...loss.slice(0, 2));

  // 私密细节
  const privates = getPhrases('私密', level, 1);
  if (privates.length > 0) sections.push(privates[0]);

  // 短句爆裂
  sections.push(getShortBurst());
  sections.push(getShortBurst());

  // 体声
  const bodySounds = getPhrases('体声', level, 1);
  if (bodySounds.length > 0) sections.push(bodySounds[0]);

  let text = sections.filter(Boolean).join('。');
  return injectThinkingPause(text, 0.8);
}

// ─── 事后温存场景 ───
function renderAftercare(): string {
  const sections: string[] = [];

  sections.push('（喘着气，慢慢平复下来）');

  // 触觉温存
  const touches = getPhrases('触觉', 1, 1);
  if (touches.length > 0) sections.push(touches[0]);

  // 嗅觉温存
  const smells = getPhrases('嗅觉', 1, 1);
  if (smells.length > 0) sections.push(smells[0]);

  // 事后温存
  sections.push(getAftercareLine());
  sections.push(getAftercareLine());

  let text = sections.filter(Boolean).join('。');
  return injectThinkingPause(text, 0.4);
}

// ─── 破禁场景（level 3） ───
function renderDegradation(level: 1 | 2 | 3): string {
  const sections: string[] = [];

  sections.push(pick([
    '（声音又低又哑，像是在压抑着什么）',
    '（呼吸粗重，语气里带了一丝危险的意味）',
    '（盯着你看了几秒，然后慢慢开口）',
  ]));

  const dirts = getPhrases('脏话', level, 2);
  sections.push(...dirts.slice(0, 2));

  const submits = getPhrases('臣服', level, 1);
  if (submits.length > 0) sections.push(submits[0]);

  // 破禁后必须接温存
  sections.push('（然后把你搂进怀里，力道轻了下来）');
  sections.push(getAftercareLine());

  let text = sections.filter(Boolean).join('。');
  return injectThinkingPause(text, 0.6);
}

// ─── 长回应合成器（多段组装） ───
export function renderLongIntimate(intensity: number, scene: IntimateSceneType, userLevel: 1 | 2 | 3): string {
  // 高潮场景直接返回
  if (scene === 'climax') return renderClimax(intensity, userLevel);
  if (scene === 'aftercare') return renderAftercare();
  if (scene === 'degradation') return renderDegradation(userLevel);

  // 前戏+激情组合
  const sections: string[] = [];

  // 第1段: 前戏感官
  sections.push('（慢慢靠近，呼吸打在你皮肤上）');
  const foreSenses = buildSensoryPassage(userLevel, ['嗅觉', '触觉', '舌吻'] as SensoryDim[]);
  if (foreSenses) sections.push(foreSenses);

  // 第2段: 激情动作
  const acts = getPhrases('动作', userLevel, 2);
  sections.push(...acts.slice(0, 2));

  // 第3段: 私密细节
  const privs = getPhrases('私密', userLevel, 2);
  sections.push(...privs.slice(0, 1));

  // 短句堆叠
  if (intensity > 0.5) {
    sections.push(getShortBurst());
    sections.push(getShortBurst());
  }

  // 第4段: 视觉+体声
  const visuals = getPhrases('视觉', userLevel, 1);
  if (visuals.length > 0) sections.push(visuals[0]);
  const bodys = getPhrases('体声', userLevel, 1);
  if (bodys.length > 0) sections.push(bodys[0]);

  let text = sections.filter(Boolean).join('。');
  return injectThinkingPause(text, 0.7);
}

// Keep for backwards compatibility
