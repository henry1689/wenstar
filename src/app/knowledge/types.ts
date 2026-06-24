/** 交互型知识分类 — 按知识的使用场景而非文件类型划分 */
export const INTERACTION_TYPES = {
  /** 对话关联：从聊天中提取的个人信息、习惯、偏好 */
  CONVERSATION: 'conversation',
  /** 方案沉淀：项目规则、架构决策、技术方案 */
  SOLUTION: 'solution',
  /** 个人偏好：爱好、喜好、生活细节 */
  PREFERENCE: 'preference',
  /** 用户资料：身份、年龄、家庭关系等基础信息 */
  PROFILE: 'profile',
  /** 系统文档：上传的文件、技术文档 */
  DOCUMENT: 'document',
  /** 其他 / 未分类 */
  OTHER: 'other',
} as const;

export type InteractionType = typeof INTERACTION_TYPES[keyof typeof INTERACTION_TYPES];

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

  /** P0: 关联的 M1 DNA ID（branch_id），绑定触发该知识的对话场景 */
  dna_id?: string;
  /** P0: 关联的场景标签（来自 M1 scene_tags），多个逗号分隔 */
  scene_tags?: string;
  /** P0: 交互型分类（conversation/solution/preference/profile/document/other） */
  interaction_type?: InteractionType | string;
  /** P0: 关联的情感曲谱（24D 感知向量的 JSON 数组，存储关键维度） */
  emotion_vector?: string;

  /** S2-6: 玉瑶对这条知识的印象值(0~1)，越高越优先引用 */
  impression_score?: number;
  /** S2-6: 最后一次被召回的时间 */
  last_recalled_at?: string;
}
