/** 知识条目 — 应用层类型定义 */
export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  source_type: string;
  source_name: string | null;
  file_size: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  locked: boolean;
}
