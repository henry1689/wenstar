import { CELEBRITY_PERSONA } from './persona.js';
import type { IPersona } from '../../types.js';

export const celebrityPersona: IPersona = {
  id: 'celebrity',
  name: '女明星 · 星光',
  description: '光芒四射的女明星 — 优雅风趣、从容自信',
  buildSystemPrompt(_level, knowledge?): string {
    let p = CELEBRITY_PERSONA;
    if (knowledge) p += `\n\n[用户知识库]\n${knowledge}`;
    return p;
  },
};
