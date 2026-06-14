// M7-Dream · DreamInternalizer — 疤痕检查 + 生理反馈 + 内化写入
// Ref: docs/M7-design-v1.md §3-§4
// @module M7-Dream

import type { M8Engine } from '../m8/M8Engine.js';
import type { M6Orchestrator } from '../m6/M6Orchestrator.js';
import { DreamQueue } from './DreamQueue.js';
import type { PendingDream } from './types/index.js';

export interface InternalizeResult {
  id: string;
  status: 'confirmed' | 'rejected' | 'soften';
  feedback?: { adaption_text?: string; rejection_text?: string };
}

export class DreamInternalizer {
  private queue: DreamQueue;
  private m8: M8Engine;
  private _m6: M6Orchestrator | null = null;

  constructor(queue: DreamQueue, m8: M8Engine) {
    this.queue = queue;
    this.m8 = m8;
  }

  /** 注入 M6（延迟注入 — M6 在 M7 之后初始化） */
  setM6(m6: M6Orchestrator): void {
    this._m6 = m6;
  }

  /** 内化前检查顺序 */
  async internalize(dreamId: string): Promise<InternalizeResult> {
    const dream = this.queue.getPending().find(d => d.id === dreamId);
    if (!dream) return { id: dreamId, status: 'rejected' };

    // 第1步：M8 疤痕检查
    const conflict = await this.m8.checkConflict({
      target: dream.affected_traits.join(','),
      direction: 'increase',
      delta: 10,
    });

    if (conflict.hasConflict && conflict.suggestion === 'block') {
      // 将冲突写回疤痕记录，闭合"创建→检测"回路
      if (dream.related_memory_id) {
        await this.m8.markScar(dream.related_memory_id, 'boundary_test');
        console.log(`[Scar] 已标记创伤类型: boundary_test → ${dream.related_memory_id}`);
      }
      this.queue.updateStatus(dreamId, 'conflict');
      return { id: dreamId, status: 'rejected' };
    }

    if (conflict.hasConflict && conflict.suggestion === 'soften') {
      if (dream.related_memory_id) {
        await this.m8.markScar(dream.related_memory_id, 'misunderstanding');
        console.log(`[Scar] 已标记创伤类型: misunderstanding → ${dream.related_memory_id}`);
      }
      this.queue.updateStatus(dreamId, 'probing');
      return {
        id: dreamId, status: 'soften',
        feedback: { rejection_text: `想到这个${dream.content.substring(0, 10)}，胃里有点紧…我们慢慢来好不好？` },
      };
    }

    // 第2步：无冲突 → 确认
    this.queue.updateStatus(dreamId, 'confirmed');

    // 通知 M6：梦境确认后执行大幅演化（使用编排器代理方法）
    if (this._m6 && dream.affected_traits.length > 0) {
      for (const trait of dream.affected_traits) {
        try {
          this._m6.applyConfirmed(trait, 'increase', 10);
          console.log(`[Dream→M6] 梦境确认触发 ${trait} 演化`);
        } catch (err) {
          console.warn(`[Dream→M6] ${trait} 演化失败:`, err);
        }
      }
    }

    // 第3步：记忆沉淀 — 将关联记忆晋升为地标（设计文档 §1.1 第四项职责 — 修复: 补全 M7→M8 写入链路）
    if (dream.related_memory_id) {
      try {
        await this.m8.promoteMemory(dream.related_memory_id, '梦境沉淀', dream.content.substring(0, 20));
        console.log(`[Dream→M8] 已沉淀为地标: ${dream.related_memory_id}`);
      } catch (err) {
        console.warn(`[Dream→M8] 沉淀失败:`, err);
      }
    }

    return {
      id: dreamId, status: 'confirmed',
      feedback: { adaption_text: `这个${dream.content.substring(0, 10)}让我耳朵发烫…但心里是甜的。` },
    };
  }

  /** 批量内化 */
  async internalizeBatch(): Promise<InternalizeResult[]> {
    const pending = this.queue.getPending();
    const results: InternalizeResult[] = [];
    for (const dream of pending) {
      results.push(await this.internalize(dream.id));
    }
    return results;
  }

  /** 丢弃旧条目（7天未处理） */
  discardStale(): void {
    const now = Date.now();
    const pending = this.queue.getPending();
    for (const dream of pending) {
      const age = (now - new Date(dream.created_at).getTime()) / (1000 * 86400);
      if (age >= 7) {
        this.queue.remove(dream.id);
      }
    }
  }
}
