// M4 知识融合层类型定义
// Ref: M4-design-v1.md §2-§5

import type { M3Decision } from '../../m3/types/perception.js';

export interface MemorySummary {
  timeline: Array<{
    time: string;
    summary: string;
    calcium_level: number;
  }>;
  frequentEntities: Array<{ name: string; type: string; mentionCount: number }>;
  timeSpan: { earliest: string; latest: string };
}

export interface M4Context {
  decision: M3Decision;
  memory_summary: MemorySummary;
  family_context?: Array<{ entity: string; relation: string; related_entity: string }>;
  /** 社交关系上下文（从 FamilyGraph 社交边提取，与 family_context 互补） */
  social_context?: Array<{ entity: string; relation: string; related_entity: string }>;
  current_time: string;
  meta: {
    has_history: boolean;
    has_family_context: boolean;
    calcium_level: number;
    dominant_action: string;
  };
  /** P2: 检索质量报告 */
  retrieval_quality?: {
    total_candidates: number;
    avg_match_score: number;
    strategies_used: string[];
  };
}
