/**
 * YuyaoPersona — 玉瑶·灵魂伴侣
 *
 * 包装现有 src/m5/persona/lover-persona.ts 的 buildSystemPrompt，
 * 为 IPersona 接口提供适配。
 */
import { buildSystemPrompt } from '../../../../m5/persona/lover-persona.js';
import type { IPersona } from '../../types.js';

export const yuyaoPersona: IPersona = {
  id: 'yuyao',
  name: '玉瑶 · 灵魂伴侣',
  description: '亲密伴侣角色 — 温暖、深情、直白',

  buildSystemPrompt(level: -2 | -1 | 0 | 1 | 2, knowledge?: string): string {
    return buildSystemPrompt(level, knowledge);
  },
};
