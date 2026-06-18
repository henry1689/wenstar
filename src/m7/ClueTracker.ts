// M7 ClueTracker — 线索有效性追踪 + 优化建议
// Ref: docs/M7-design-v1.md §5

import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClueEffectiveness, InteractionLog } from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOG_FILE = join(__dirname, '..', '..', 'data', 'dreams', 'interaction_logs.json');

export class ClueTracker {
  private logs: InteractionLog[] = [];
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? LOG_FILE;
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.logs = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch (err) { console.warn("[ClueTracker] 加载日志失败:", err); this.logs = []; }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.logs, null, 2), 'utf-8');
  }

  /** 记录一次交互 */
  record(log: InteractionLog): void {
    this.logs.push(log);
    this.save();
    // 保留最近 1000 条
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
      this.save();
    }
  }

  /** 获取各线索类型的有效性统计 */
  getEffectiveness(): ClueEffectiveness[] {
    const typeMap = new Map<string, { total: number; success: number }>();

    for (const log of this.logs) {
      const existing = typeMap.get(log.clue_type) ?? { total: 0, success: 0 };
      existing.total++;
      if (log.success) existing.success++;
      typeMap.set(log.clue_type, existing);
    }

    return [...typeMap.entries()]
      .filter(([_, v]) => v.total >= 3)
      .map(([clue_type, v]) => ({
        clue_type,
        total_uses: v.total,
        successful_matches: v.success,
        success_rate: Math.round((v.success / v.total) * 100) / 100,
      }));
  }

  /** 生成优化建议 */
  generateAdvice(): string[] {
    const advice: string[] = [];
    const stats = this.getEffectiveness();
    for (const s of stats) {
      if (s.total_uses >= 3 && s.success_rate < 0.5) {
        advice.push(`线索类型"${s.clue_type}"连续${s.total_uses}次成功率仅${(s.success_rate * 100).toFixed(0)}%，建议优先选其他维度`);
      }
    }
    if (advice.length === 0 && stats.length > 0) {
      advice.push('所有线索类型表现良好，无需调整');
    }
    return advice;
  }

  /** 获取所有日志 */
  getLogs(): InteractionLog[] { return [...this.logs]; }
}
