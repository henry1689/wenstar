import { COUNSELOR_PERSONA } from './persona.js';
import type { IPersona } from '../../types.js';

export const counselorPersona: IPersona = {
  id: 'counselor',
  name: '心理咨询师',
  description: '专业温暖的心理咨询 — 倾听、共情、引导',
  buildSystemPrompt(_level, knowledge?): string {
    let p = COUNSELOR_PERSONA;
    if (knowledge) p += `\n\n[用户知识库]\n${knowledge}`;
    return p;
  },
};
