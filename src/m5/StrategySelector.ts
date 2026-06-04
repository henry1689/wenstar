// M5 Step 2: 策略选择 — 规则引擎，零LLM
// Ref: M5-design-v1.md §3

import type { CognitionObject, StrategyConfig } from './types/index.js';
import type { M3Action } from '../m3/types/perception.js';

const STRATEGY_TEMPLATES: Record<string, { strategy_id: string; description: string; max_length: number }> = {
  'mem-general': { strategy_id: 'mem-general', description: '简短确认，无需深度回应', max_length: 20 },
  'ask-curious': { strategy_id: 'ask-curious', description: '好奇追问，主动表达兴趣', max_length: 80 },
  'com-warm': { strategy_id: 'com-warm', description: '温暖支持，共情回应', max_length: 100 },
  'mem-ask': { strategy_id: 'mem-ask', description: '先确认再追问', max_length: 60 },
  'act-core': { strategy_id: 'act-core', description: '核心响应，全力投入', max_length: 150 },
};

export class StrategySelector {
  select(cognition: CognitionObject): StrategyConfig {
    const action = cognition.current.action;
    const template = this.selectTemplate(action, cognition);
    const tpl = STRATEGY_TEMPLATES[template];

    return {
      strategy_id: tpl.strategy_id,
      params: {
        tone: cognition.strategy_hint.tone,
        max_length: tpl.max_length,
        include_entity: cognition.current.key_entities,
        include_history: cognition.history.has_relevant_history,
        include_family: cognition.family?.has_family_context ?? false,
      },
      description: tpl.description,
    };
  }

  private selectTemplate(actions: M3Action[], cognition: CognitionObject): string {
    if (actions.includes('act')) return 'act-core';
    if (actions.includes('comfort')) return 'com-warm';
    if (actions.includes('ask') && actions.includes('memorize')) return 'mem-ask';
    if (actions.includes('ask')) return 'ask-curious';
    return 'mem-general';
  }
}
