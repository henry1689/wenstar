import { COLLEAGUE_PERSONA } from './persona.js';
import type { IPersona } from '../../types.js';

export const colleaguePersona: IPersona = {
  id: 'colleague',
  name: '女同事 · 搭档',
  description: '干练开朗的女同事 — 工作搭档、职场伙伴',
  buildSystemPrompt(_level, knowledge?): string {
    let p = COLLEAGUE_PERSONA;
    if (knowledge) p += `\n\n[用户知识库]\n${knowledge}`;
    return p;
  },
};
