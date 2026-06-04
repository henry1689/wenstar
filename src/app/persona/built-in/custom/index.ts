import { CUSTOM_PERSONA } from './persona.js';
import type { IPersona } from '../../types.js';

export const customPersona: IPersona = {
  id: 'custom',
  name: '自定义 · 女伴',
  description: '可自定义的伴侣角色 — 编辑 persona.ts 修改人设',
  buildSystemPrompt(_level, knowledge?): string {
    let p = CUSTOM_PERSONA;
    if (knowledge) p += `\n\n[用户知识库]\n${knowledge}`;
    return p;
  },
};
