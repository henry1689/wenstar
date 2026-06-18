// M6 NarrativeBuilder — 叙事层追加 + 冲突检测
// Ref: docs/M6-design-v1.md §3.4

import { SelfModelManager } from './SelfModelManager.js';

export class NarrativeBuilder {
  private manager: SelfModelManager;

  constructor(manager: SelfModelManager) {
    this.manager = manager;
  }

  /** 添加重大事件叙事层 — 用 triggerEvent（对话原文）作为叙事文本 */
  addLayer(text: string, triggerEvent: string, calcium: number): void {
    if (calcium < 1) return; // 钙质≥1即视为有意义事件，记录到叙事层
    this.manager.addNarrativeLayer({
      text, trigger_event: triggerEvent, calcium_at_event: calcium,
      created_at: new Date().toISOString(),
    });
  }

  /** 检测新旧叙事冲突 */
  detectConflict(newText: string): string[] {
    const conflicts: string[] = [];
    const layers = this.manager.getNarrativeLayers();
    for (const layer of layers) {
      // 简单检测：新旧叙事相互矛盾
      const contradictions = [
        ['恨', '爱'], ['讨厌', '喜欢'], ['离开', '留下'],
        ['冷漠', '热情'], ['孤独', '陪伴'],
      ];
      for (const [neg, pos] of contradictions) {
        const oldHasNeg = layer.text.includes(neg) && !newText.includes(pos);
        const newHasNeg = newText.includes(neg) && !layer.text.includes(pos);
        if (oldHasNeg || newHasNeg) {
          conflicts.push(`叙事冲突: 层${layer.layer_id}("${layer.text.substring(0, 20)}") vs 新叙事("${newText.substring(0, 20)}")`);
        }
      }
    }
    return conflicts;
  }
}
