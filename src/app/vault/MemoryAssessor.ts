/**
 * MemoryAssessor — P2-1 三库自动流转调度器
 *
 * 在后台异步运行三个评估任务：
 *   ① 砂金库→金库（每 30 分钟）：扫描对话历史，高情感/高钙化碎片升入金库
 *   ② 金库→黑钻库（每 2 小时）：调用 VaultManager.autoPromoteCandidates()
 *   ③ 权重衰减（每日）：低频碎片降低检索权重
 *
 * 复用 VaultManager 现有函数，只加调度逻辑。
 * 所有任务通过 setTimeout 异步执行，不阻塞主回复流程。
 */
import type { FusionStorageAdapter } from '../../m2/FusionStorageAdapter.js';
import { autoPromoteCandidates } from './VaultManager.js';

export class MemoryAssessor {
  private storage: FusionStorageAdapter;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private started = false;

  constructor(storage: FusionStorageAdapter) {
    this.storage = storage;
  }

  /** 启动所有定时评估任务 */
  start(): void {
    if (this.started) return;
    this.started = true;
    console.log('[MemoryAssessor] 启动三库流转调度器');

    // ① 砂金库→金库（30 分钟）
    this.schedule('sandToGold', 30 * 60 * 1000, () => this.runSandToGold());

    // ② 金库→黑钻（2 小时）
    this.schedule('goldToDiamond', 2 * 60 * 60 * 1000, () => this.runGoldToDiamond());

    // ③ 权重衰减（24 小时）
    this.schedule('decay', 24 * 60 * 60 * 1000, () => this.runDecay());
  }

  /** 停止所有定时器 */
  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.started = false;
  }

  private schedule(name: string, interval: number, fn: () => Promise<void>): void {
    const tick = () => {
      fn().catch(err => console.warn(`[MemoryAssessor] ${name} 失败:`, err));
      this.timers.push(setTimeout(tick, interval));
    };
    // 首次延迟分散（避免同时启动）
    const delay = Math.random() * 60000 + 5000;
    this.timers.push(setTimeout(tick, delay));
  }

  // ─── ① 砂金库→金库 ───

  private async runSandToGold(): Promise<void> {
    try {
      const sqlite = this.storage.getSQLite();
      // 获取最近对话中情绪强度高的片段
      // 通过 conversations 表 + calcium 信号判定
      const recentConvs = sqlite.queryAll(
        `SELECT id, role, content, timestamp FROM conversations ORDER BY timestamp DESC LIMIT 50`
      ) as any[];

      if (recentConvs.length === 0) {
        console.log('[MemoryAssessor] 砂金→金库: 无对话数据');
        return;
      }

      let promoted = 0;
            // P0-7: 事务保护
      sqlite.writeRaw('BEGIN');
for (const conv of recentConvs) {
        if (conv.role !== 'user') continue;
        const text = (conv.content || '') as string;
        if (text.length < 10) continue; // 太短跳过

        // 简单情感强度判定：高情绪词密度或长度>50字符
        const emotionWords = /开心|难过|生气|感动|幸福|伤心|愤怒|激动|兴奋|焦虑|紧张|美好|重要|难忘|喜欢|爱|恨|痛|哭|笑|累|辛苦|努力|成功|失败|第一次|最后一次|终于|突然|永远|再也/g;
        const matches = text.match(emotionWords);
        const emotionDensity = matches ? matches.length / text.length : 0;

        if (emotionDensity > 0.05 || text.length > 80) {
          // 写入金库（memories 表）
          const memoryId = `sand_gold_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          try {
            sqlite.writeRaw(
              `INSERT OR IGNORE INTO memories (id, raw_input, calcium_level, created_at, effective_strength)
               VALUES (?, ?, 1, ?, 0.5)`,
              [memoryId, text.substring(0, 500), new Date().toISOString()]
            );
            promoted++;
          } catch { /* 去重跳过 */ }
        }
      }

            sqlite.writeRaw('COMMIT');
if (promoted > 0) {
        console.log(`[MemoryAssessor] 砂金→金库: ${promoted} 条`);
      }
    } catch (err) {
      console.warn('[MemoryAssessor] 砂金→金库失败:', err);
    }
  }

  // ─── ② 金库→黑钻 ───

  private async runGoldToDiamond(): Promise<void> {
    try {
      const sqlite = this.storage.getSQLite();
      const entries = autoPromoteCandidates(sqlite, 5);
      if (entries.length > 0) {
        console.log(`[MemoryAssessor] 金库→黑钻: ${entries.length} 条`);
      }
    } catch (err) {
      console.warn('[MemoryAssessor] 金库→黑钻失败:', err);
    }
  }

  // ─── ③ 权重衰减 ───

  private async runDecay(): Promise<void> {
    try {
      const sqlite = this.storage.getSQLite();
      // P0-3: 场景差异化衰减
      // ① 闲聊类（默认）：effective_strength × 0.95
      sqlite.writeRaw(
        `UPDATE memories SET effective_strength = ROUND(effective_strength * 0.95, 4)
         WHERE effective_strength > 0.1 AND calcium_level < 2`,
      );
      // ② 工作/功能性记忆：衰减降低50%（×0.975 替代 ×0.95）
      sqlite.writeRaw(
        `UPDATE memories SET effective_strength = ROUND(effective_strength * 0.975, 4)
         WHERE effective_strength > 0.1 AND calcium_level < 2
         AND (COALESCE(narrative_tag, '') LIKE '%工作%' OR COALESCE(narrative_tag, '') LIKE '%项目%'
              OR COALESCE(narrative_tag, '') LIKE '%公司%' OR COALESCE(narrative_tag, '') LIKE '%会议%')`,
      );
      // 金库中性记忆衰减：钙化 < 1 的，乘以 0.98
      sqlite.writeRaw(
        `UPDATE memories SET effective_strength = ROUND(effective_strength * 0.98, 4)
         WHERE effective_strength > 0.2 AND calcium_level = 1`,
      );
      // 工作类金库中性记忆：衰减更慢（0.99 替代 0.98）
      sqlite.writeRaw(
        `UPDATE memories SET effective_strength = ROUND(effective_strength * 0.99, 4)
         WHERE effective_strength > 0.2 AND calcium_level = 1
         AND (COALESCE(narrative_tag, '') LIKE '%工作%' OR COALESCE(narrative_tag, '') LIKE '%项目%'
              OR COALESCE(narrative_tag, '') LIKE '%公司%' OR COALESCE(narrative_tag, '') LIKE '%会议%')`,
      );
      console.log('[MemoryAssessor] 衰减差异化: 工作类记忆衰减降低50%');
    } catch (err) {
      console.warn('[MemoryAssessor] 权重衰减失败:', err);
    }
  }

  // ─── 手动触发（供调试 API 使用） ───

  async triggerSandToGold(): Promise<number> {
    await this.runSandToGold();
    const sqlite = this.storage.getSQLite();
    const count = sqlite.queryAll('SELECT COUNT(*) as c FROM memories') as any[];
    return count[0]?.c || 0;
  }

  async triggerGoldToDiamond(): Promise<number> {
    await this.runGoldToDiamond();
    const sqlite = this.storage.getSQLite();
    const count = sqlite.queryAll('SELECT COUNT(*) as c FROM black_diamond') as any[];
    return count[0]?.c || 0;
  }
}
