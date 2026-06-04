import { MENTOR_PERSONA } from './persona.js';
import type { IPersona } from '../../types.js';

export const mentorPersona: IPersona = {
  id: 'mentor',
  name: '导师 · 引路人',
  description: '知识渊博的导师 — 启发思考、答疑解惑',
  buildSystemPrompt(_level, knowledge?): string {
    let p = MENTOR_PERSONA;
    if (knowledge) p += `\n\n[用户知识库]\n${knowledge}`;
    return p;
  },
};
