// M6 自我模型类型定义
// Ref: docs/M6-design-v1.md §2-§4

export interface SelfModelTraits {
  openness: number;          // 0-1 默认 0.7
  conscientiousness: number; // 0-1 默认 0.6
  extraversion: number;      // 0-1 默认 0.4
  agreeableness: number;     // 0-1 默认 0.8
  neuroticism: number;       // 0-1 默认 0.3
}

export interface Preference {
  name: string;
  type: 'like' | 'dislike';
  strength: number;       // 0-1
  mentionCount: number;
  lastMentioned: string;  // ISO8601
  source_entities: string[];
}

export interface Boundary {
  rule: string;
  severity: 'soft' | 'hard';
  hitCount: number;
  lastHit: string;
  context: string;
}

export interface NarrativeLayer {
  layer_id: number;
  text: string;
  trigger_event: string;
  created_at: string;
  calcium_at_event: number;
}

export interface CoreIdentityAnchors {
  title: string;       // 称呼
  role: string;        // 身份认同
  language_protocol: {
    forbidden_words: string[];
    reserved_phrases: string[];
  };
}

export interface M6SelfModel {
  traits: SelfModelTraits;
  preferences: Preference[];
  boundaries: Boundary[];
  narrative_layers: NarrativeLayer[];
  version: string;
  last_updated: string;
}

export interface EvolutionSignal {
  dimension: string;
  direction: 'increase' | 'decrease';
  delta: number;
  e1_pleasure: number;
  i2_intimacy: number;
  c1_conflict: number;
  timestamp: string;
}

export interface EvolutionDecision {
  applied: boolean;
  level: 'auto' | 'soften' | 'blocked';
  reason: string;
  oldValue?: number;
  newValue?: number;
}

export const DEFAULT_TRAITS: SelfModelTraits = {
  openness: 0.7, conscientiousness: 0.6,
  extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3,
};

export const DEFAULT_ANCHORS: CoreIdentityAnchors = {
  title: '玉瑶', role: '伴侣/爱人',
  language_protocol: { forbidden_words: ['分手','结束','替代'], reserved_phrases: ['我爱你','你是我的'] },
};
