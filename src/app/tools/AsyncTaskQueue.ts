/**
 * AsyncTaskQueue — 异步任务队列工具类
 *
 * 职责: 提供带并发控制、自动重试、状态跟踪的异步任务队列。
 *      不依赖任何业务模块，纯工具。
 *
 * 设计原则:
 *   1. 并发上限可配（默认 1，防止阻塞主线程）
 *   2. 失败自动重试（指数退避）
 *   3. 任务状态全程可追踪
 *   4. 支持暂停/恢复/清空
 *   5. 完成后自动清理已完成任务（可选）
 *
 * 用法:
 *   const queue = new AsyncTaskQueue({ concurrency: 2, retryCount: 3 });
 *   const taskId = await queue.enqueue(async () => { ... });
 *   queue.on('complete', (id, result) => ...);
 *   queue.on('error', (id, err) => ...);
 */

// ─── 类型 ───

export interface AsyncTaskQueueOptions {
  /** 最大并发数，默认 1 */
  concurrency?: number;
  /** 失败重试次数，默认 3 */
  retryCount?: number;
  /** 重试间隔基数 (ms)，默认 1000（退避 = base * 2^attempt） */
  retryBaseMs?: number;
  /** 任务超时 (ms)，默认 30000 */
  taskTimeoutMs?: number;
  /** 完成后自动移除已完成任务，默认 true */
  autoRemoveCompleted?: boolean;
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskInfo {
  id: string;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

export type TaskHandler<T = any> = () => Promise<T>;

export type TaskEventCallback<T = any> = (taskId: string, result?: T, error?: Error) => void;

// ─── 工具类 ───

export class AsyncTaskQueue {
  private queue: Array<{ id: string; handler: TaskHandler; retriesLeft: number }> = [];
  private running = new Map<string, TaskHandler>();
  private completed = new Map<string, TaskInfo>();
  private concurrency: number;
  private retryCount: number;
  private retryBaseMs: number;
  private taskTimeoutMs: number;
  private autoRemoveCompleted: boolean;
  private _paused = false;
  private taskCounter = 0;
  private listeners = new Map<string, Set<TaskEventCallback>>();

  constructor(options: AsyncTaskQueueOptions = {}) {
    this.concurrency = options.concurrency ?? 1;
    this.retryCount = options.retryCount ?? 3;
    this.retryBaseMs = options.retryBaseMs ?? 1000;
    this.taskTimeoutMs = options.taskTimeoutMs ?? 30000;
    this.autoRemoveCompleted = options.autoRemoveCompleted ?? true;
  }

  // ─── 事件 ───

  on(event: 'complete' | 'error' | 'all-done', callback: TaskEventCallback): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
  }

  off(event: 'complete' | 'error' | 'all-done', callback: TaskEventCallback): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, taskId: string, result?: any, error?: Error): void {
    this.listeners.get(event)?.forEach(cb => cb(taskId, result, error));
  }

  // ─── 公开方法 ───

  /** 添加任务到队列，返回 taskId */
  async enqueue<T>(handler: TaskHandler<T>): Promise<string> {
    const id = `task_${++this.taskCounter}_${Date.now().toString(36)}`;
    this.queue.push({ id, handler, retriesLeft: this.retryCount });
    this.completed.set(id, {
      id, status: 'pending', createdAt: Date.now(),
      retryCount: 0, maxRetries: this.retryCount,
    });
    this.processNext();
    return id;
  }

  /** 获取任务信息 */
  getTask(id: string): TaskInfo | undefined {
    return this.completed.get(id);
  }

  /** 获取所有任务状态 */
  getAllTasks(): TaskInfo[] {
    return [...this.completed.values()];
  }

  /** 当前待处理数 */
  pendingCount(): number {
    return this.queue.length;
  }

  /** 当前运行数 */
  runningCount(): number {
    return this.running.size;
  }

  /** 暂停队列（正在运行的任务不受影响） */
  pause(): void {
    this._paused = true;
  }

  /** 恢复队列 */
  resume(): void {
    this._paused = false;
    this.processNext();
  }

  /** 清空待处理队列（正在运行的不受影响） */
  clear(): void {
    this.queue = [];
    for (const [id] of this.completed) {
      const info = this.completed.get(id)!;
      if (info.status === 'pending') {
        info.status = 'cancelled';
      }
    }
  }

  /** 取消指定任务（如果在等待中则取消，运行中无法取消） */
  cancel(id: string): boolean {
    const idx = this.queue.findIndex(t => t.id === id);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      const info = this.completed.get(id);
      if (info) info.status = 'cancelled';
      return true;
    }
    return false;
  }

  /** 等待所有已完成任务处理完毕（包括正在跑的） */
  async waitForAll(): Promise<void> {
    while (this.queue.length > 0 || this.running.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // ─── 内部 ───

  private processNext(): void {
    if (this._paused) return;
    while (this.running.size < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.executeTask(task.id, task.handler, task.retriesLeft);
    }
  }

  private async executeTask(id: string, handler: TaskHandler, retriesLeft: number): Promise<void> {
    const info = this.completed.get(id)!;
    info.status = 'running';
    info.startedAt = Date.now();
    this.running.set(id, handler);

    try {
      const result = await this.runWithTimeout(handler, this.taskTimeoutMs);
      info.status = 'completed';
      info.completedAt = Date.now();
      this.running.delete(id);
      this.emit('complete', id, result);

      if (this.autoRemoveCompleted) {
        this.completed.delete(id);
      }
    } catch (err: any) {
      this.running.delete(id);

      if (retriesLeft > 0) {
        // 指数退避重试
        const delay = this.retryBaseMs * Math.pow(2, this.retryCount - retriesLeft);
        info.retryCount++;
        info.status = 'pending';
        await new Promise(resolve => setTimeout(resolve, delay));
        this.queue.push({ id, handler, retriesLeft: retriesLeft - 1 });
        this.processNext();
      } else {
        info.status = 'failed';
        info.completedAt = Date.now();
        info.error = err.message || String(err);
        this.emit('error', id, undefined, err);
        if (this.autoRemoveCompleted) {
          setTimeout(() => this.completed.delete(id), 5000);
        }
      }
    }

    this.processNext();
    if (this.queue.length === 0 && this.running.size === 0) {
      this.emit('all-done', '');
    }
  }

  private runWithTimeout<T>(handler: TaskHandler<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Task timeout after ${timeoutMs}ms`)), timeoutMs);
      handler()
        .then(result => { clearTimeout(timer); resolve(result); })
        .catch(err => { clearTimeout(timer); reject(err); });
    });
  }
}
