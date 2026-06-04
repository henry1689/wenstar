/**
 * SecretaryPersona — 办公秘书
 */
import { SECRETARY_PERSONA } from './persona.js';
import type { IPersona } from '../../types.js';

export const secretaryPersona: IPersona = {
  id: 'secretary',
  name: '秘书 · 行政助理',
  description: '专业行政助理 — 日程、提醒、笔记',

  buildSystemPrompt(_level: -2 | -1 | 0 | 1 | 2, knowledge?: string): string {
    let prompt = SECRETARY_PERSONA;

    if (knowledge) {
      prompt += `\n\n[用户知识库]\n${knowledge}\n如果以上信息与用户问题相关，请用这些事实回答。`;
    }

    return prompt;
  },
};
