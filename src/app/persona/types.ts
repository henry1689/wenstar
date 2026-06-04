/** 人格引擎 · 类型定义 */

export interface IPersona {
  /** 角色唯一标识 */
  readonly id: string;
  /** 显示名称 */
  readonly name: string;
  /** 简短描述 */
  readonly description: string;

  /**
   * 构建 System Prompt
   * @param level   情感等级 -2~+2（秘书等非情感角色可忽略）
   * @param knowledge 可选的知识库文本
   */
  buildSystemPrompt(level: -2 | -1 | 0 | 1 | 2, knowledge?: string): string;
}
