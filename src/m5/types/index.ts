// M5 表达生成层类型定义
// Ref: M5-design-v1.md §2-§4

import type { M3Action, M3Context } from '../../m3/types/perception.js';

export interface CognitionObject {
  current: {
    action: M3Action[];
    emotion_summary: string;
    key_entities: string[];
    calcium_level: number;
    /** 感知维度快照 — 用于情绪镜像 */
    raw_input: string;
    perception_snapshot: {
      pleasure: number;
      arousal: number;
      intimacy: number;
      sexual_attraction: number;
      sensory_craving: number;
      energy_merge: number;
      possessiveness: number;
      ecstasy: number;
      sincerity: number;
      aggression: number;
      dominance: number;
      safety: number;
    };
  };
  history: {
    has_relevant_history: boolean;
    summary: string;
    time_span: string;
  };
  family?: {
    has_family_context: boolean;
    relationships: string[];
  };
  strategy_hint: {
    tone: 'warm' | 'neutral' | 'serious' | 'intimate';
    depth: 'shallow' | 'medium' | 'deep';
    urgency: 'low' | 'medium' | 'high';
  };
}

export interface StrategyConfig {
  strategy_id: string;
  params: {
    tone: string;
    emotion_color?: string;
    max_length: number;
    include_entity: string[];
    include_history: boolean;
    include_family: boolean;
  };
  description: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;  // ISO 8601 时间戳
}

export interface LLMProvider {
  generate(params: {
    strategy: StrategyConfig;
    cognition: CognitionObject;
    conversationHistory?: ConversationTurn[];
    /** 知识库内容（注入到系统提示层） */
    knowledgeBase?: string;
    /** 当前系统时间（Asia/Shanghai） */
    currentTime?: string;
    /** 用户本轮原始输入（未经过 M1-M4 管线处理，用于精确关键词匹配） */
    userMessage?: string;
  }): Promise<{ text: string; usage?: { prompt: number; completion: number } }>;

  /** 切换角色 (可选实现) */
  setPersona?(persona: import('../../app/persona/types.js').IPersona): void;
}
