// M5 Step 1: 认知组装 — 纯函数，零LLM，<20ms
// Ref: M5-design-v1.md §2
// v1.1: 传递感知维度快照给 M5，支持情绪镜像

import type { M4Context } from '../m4/types/index.js';
import type { CognitionObject } from './types/index.js';

export class CognitionAssembler {
  assemble(m4ctx: M4Context): CognitionObject {
    const decision = m4ctx.decision;
    const p = decision.enhanced.perception;

    // 构建情绪摘要 — 优先检测亲密维度，多维度同时触发时输出更强信号
    let emotionSummary = '中性表达';
    // 🔥 多维亲密度检测
    const intimateCount = [p.intimacy, p.sexual_attraction, p.sensory_craving, p.energy_merge, p.ecstasy].filter(v => v > 0.3).length;
    const hasIntimate = p.intimacy > 0.3 || p.sexual_attraction > 0.2 || p.sensory_craving > 0.3;

    if (p.pleasure > 0.3) emotionSummary = '表达了积极情绪';
    else if (p.pleasure < -0.3) emotionSummary = '表达了负面情绪';

    if (intimateCount >= 4) {
      emotionSummary = '🔥 处于炽热激情状态，多维度亲密度极高';
    } else if (intimateCount >= 2) {
      emotionSummary = '💕 处于亲密互动状态，有较强的亲密度和渴望';
    } else if (hasIntimate) {
      emotionSummary = '💗 带有亲密感';
    }
    if (p.aggression > 0.5) emotionSummary += '，带有明显攻击性';
    if (p.humor > 0.5) emotionSummary += '，带有幽默感';
    const hasHistory = m4ctx.memory_summary.timeline.length > 0;
    let historySummary = '无相关历史记忆';
    let timeSpan = '';
    if (hasHistory) {
      // 展开最近 5 条相关记忆摘要，每条附带钙化强度标记
      const recentItems = m4ctx.memory_summary.timeline.slice(0, 5);
      const levelLabel = ['粉末', '液体', '固体', '晶体'];
      historySummary = recentItems
        .map((item) => {
          const text = item.summary.replace(/\.\.\.$/, '').substring(0, 40);
          const level = item.calcium_level ?? 1;
          const label = levelLabel[level] ?? '液体';
          return `「${text}」[${label}]`;
        })
        .join(' → ');
      timeSpan = m4ctx.memory_summary.timeSpan.earliest + ' ~ ' + m4ctx.memory_summary.timeSpan.latest;
    }
    if (p.energy_merge > 0.3) emotionSummary += '，带有心灵交融感';
    if (p.ecstasy > 0.3) emotionSummary += '，带有极致愉悦';

    // 策略提示 — 加入 intimate 模式
    const hasIntimatePerception = p.sexual_attraction > 0.2 || p.sensory_craving > 0.3 || p.intimacy > 0.4 || p.energy_merge > 0.3;
    const hasHighArousal = p.arousal > 0.3;

    const tone: CognitionObject['strategy_hint']['tone'] =
      hasIntimatePerception ? 'intimate'
      : decision.actions.includes('comfort') ? 'warm'
      : decision.actions.includes('act') ? 'serious'
      : 'neutral';
    const depth: CognitionObject['strategy_hint']['depth'] =
      decision.enhanced.calcium_level >= 3 ? 'deep'
      : decision.enhanced.calcium_level >= 2 || hasIntimatePerception ? 'medium'
      : 'shallow';
    const urgency: CognitionObject['strategy_hint']['urgency'] =
      decision.actions.includes('act') || hasHighArousal ? 'high'
      : decision.actions.includes('comfort') || decision.actions.includes('ask') ? 'medium'
      : 'low';

    return {
      current: {
        action: decision.actions,
        emotion_summary: emotionSummary,
        key_entities: decision.enhanced.entity_genes.map((e) => e.name),
        calcium_level: decision.enhanced.calcium_level,
        raw_input: m4ctx.decision.enhanced.raw_input,
        perception_snapshot: {
          pleasure: p.pleasure,
          arousal: p.arousal,
          intimacy: p.intimacy,
          sexual_attraction: p.sexual_attraction,
          sensory_craving: p.sensory_craving,
          energy_merge: p.energy_merge,
          possessiveness: p.possessiveness,
          ecstasy: p.ecstasy,
          safety: p.safety,
          sincerity: p.sincerity,
          aggression: p.aggression,
          dominance: p.dominance,
        },
      },
      history: {
        has_relevant_history: hasHistory,
        summary: historySummary,
        time_span: timeSpan,
      },
      family: m4ctx.family_context
        ? {
            has_family_context: true,
            relationships: m4ctx.family_context.map(
              (f) => `${f.entity} 是你的${f.relation}`
            ),
          }
        : undefined,
      strategy_hint: { tone, depth, urgency },
    };
  }
}

// 保持原有方法
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
