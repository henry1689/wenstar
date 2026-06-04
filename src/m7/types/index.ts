// M7 梦境学习类型定义
// Ref: docs/M7-design-v1.md §2

export interface PendingDream {
  id: string;
  source: string;
  content: string;
  affected_traits: string[];
  related_memory_id?: string;
  related_year_ring_id?: string;
  created_at: string;
  status: 'pending' | 'probing' | 'confirmed' | 'rejected' | 'conflict';
  conflict_check?: {
    has_conflict: boolean;
    severity: 'none' | 'soft' | 'hard';
    suggestion: 'proceed' | 'soften' | 'block';
  };
}

export interface ClueEffectiveness {
  clue_type: string;
  total_uses: number;
  successful_matches: number;
  success_rate: number;
}

export interface InteractionLog {
  user_clue: string;
  original_query: string;
  rewritten_query: string;
  clue_type: string;
  composite_score: number;
  success: boolean;
  timestamp: string;
}
