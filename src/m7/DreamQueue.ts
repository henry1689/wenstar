// M7-Dream · DreamQueue — 梦境与人格特质演化 队列管理
// Ref: docs/M7-design-v1.md §2-§3
// @module M7-Dream

import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PendingDream } from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DREAM_FILE = join(__dirname, '..', '..', 'data', 'dreams', 'pending_dreams.json');

export class DreamQueue {
  private dreams: PendingDream[] = [];
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DREAM_FILE;
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.dreams = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch (err) { console.warn("[DreamQueue] 加载失败:", err); this.dreams = []; }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.dreams, null, 2), 'utf-8');
  }

  /** 添加新梦境条目 */
  add(dream: Omit<PendingDream, 'id' | 'created_at' | 'status'>): PendingDream {
    const entry: PendingDream = {
      id: `dream_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
      ...dream,
      created_at: new Date().toISOString(),
      status: 'pending',
    };
    this.dreams.push(entry);
    this.save();
    return entry;
  }

  /** 获取指定状态的条目 */
  getByStatus(status: PendingDream['status']): PendingDream[] {
    return this.dreams.filter(d => d.status === status);
  }

  /** 获取所有待处理条目 */
  getPending(): PendingDream[] {
    return this.getByStatus('pending');
  }

  /** 更新条目状态 */
  updateStatus(id: string, status: PendingDream['status']): void {
    const dream = this.dreams.find(d => d.id === id);
    if (dream) {
      dream.status = status;
      this.save();
    }
  }

  /** 移除条目 */
  remove(id: string): void {
    this.dreams = this.dreams.filter(d => d.id !== id);
    this.save();
  }

  /** 清空所有已完成/已拒绝的条目 */
  cleanResolved(): void {
    this.dreams = this.dreams.filter(d => d.status === 'pending' || d.status === 'probing');
    this.save();
  }

  /**
   * 批量处理触发器（修复: 阈值改回10条+24h超时兜底）
   * 设计文档 §3.1 定义的三种触发条件:
   *   1. pending ≥ 10 条（批量处理）
   *   2. 任一条等待超过 24h（超时兜底，防止低频对话永远不触发）
   *   3. 用户主动说"你记住了吗？"（chat.ts 中检测后立即调用，预留）
   */
  shouldProcess(): boolean {
    if (this.getPending().length >= 10) return true;
    const now = Date.now();
    for (const d of this.dreams) {
      if (d.status === 'pending') {
        const age = (now - new Date(d.created_at).getTime()) / (1000 * 3600);
        if (age >= 24) return true;
      }
    }
    return false;
  }

  getCount(): number { return this.dreams.length; }
}
