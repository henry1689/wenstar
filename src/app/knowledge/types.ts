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
  /** 知识分类（如：角色扮演/系统文档/用户资料/工作记录/亲友信息/其他）— 铁律：无分类不检索 */
  classification?: string;
  /** 是否待分类（标记为true时，玉瑶需要主动询问用途后再激活检索） */
  classification_pending?: boolean;
}
