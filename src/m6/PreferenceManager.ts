// M6 PreferenceManager — 偏好增删改 + 强度衰减
// Ref: docs/M6-design-v1.md §3.2

import type { Preference } from './types/index.js';
import { SelfModelManager } from './SelfModelManager.js';

export class PreferenceManager {
  private manager: SelfModelManager;

  constructor(manager: SelfModelManager) {
    this.manager = manager;
  }

  /** 记录提及，自动新增/强化 */
  recordMention(name: string, e1Pleasure: number): void {
    const prefs = this.manager.getPreferences();
    const existing = prefs.find(p => p.name === name);

    if (existing) {
      existing.mentionCount++;
      existing.lastMentioned = new Date().toISOString();
      if (e1Pleasure > 0.5) existing.strength = Math.min(1, existing.strength + 0.1);
      this.manager.addPreference(existing);
    } else {
      const type = e1Pleasure > 0 ? 'like' : 'dislike';
      const pref: Preference = {
        name, type, strength: 0.5, mentionCount: 1,
        lastMentioned: new Date().toISOString(), source_entities: [],
      };
      this.manager.addPreference(pref);
    }
  }

  /** 偏好强度衰减（30天未提及 → 衰减20%） */
  applyDecay(): void {
    const now = Date.now();
    const prefs = this.manager.getPreferences();
    for (const p of prefs) {
      const daysSince = (now - new Date(p.lastMentioned).getTime()) / (1000 * 86400);
      if (daysSince >= 30) {
        p.strength *= 0.8;
        if (p.strength < 0.1) {
          this.manager.removePreference(p.name);
          continue;
        }
        this.manager.addPreference(p);
      }
    }
  }

  /** 获取活跃偏好（强度≥0.1） */
  getActive(): Preference[] {
    return this.manager.getPreferences().filter(p => p.strength >= 0.1);
  }
}
