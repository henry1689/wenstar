/**
 * MaintenanceService — 玉瑶 · 太虚境 后台维护引擎
 *
 * 定时任务：
 * - 进程健康检查（内存、事件循环）
 * - 对话记忆压缩（旧轮次→摘要）
 * - M2 存储 GC（清理过期记录）
 * - 缓存清理（tsx 等）
 *
 * 所有指标通过 getHealth() 暴露给前端。
 */

// MaintenanceService 接受的存储类型：FusionStorageAdapter 或兼容接口
type AnyStorage = { getStatus(): Promise<{ totalRecords: number }> | { totalRecords: number } };

// ──────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────

export interface HealthReport {
  status: 'ok' | 'degraded' | 'error';
  uptime: number;               // 秒
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
  };
  conversations: {
    total: number;
    oldestAgeHours: number;     // 最早对话距今小时
  };
  storage: {
    totalRecords: number;
    totalSizeKB: number;
  };
  lastMaintenance: {
    compaction: string | null;  // ISO 时间
    gc: string | null;
  };
  eventLoopLag: number;         // ms
}

// ──────────────────────────────────────────────
// 配置
// ──────────────────────────────────────────────

export interface MaintenanceConfig {
  /** 对话压缩间隔 (ms) — 默认 5 分钟 */
  compactionInterval: number;
  /** 存储 GC 间隔 (ms) — 默认 30 分钟 */
  gcInterval: number;
  /** 记忆衰减维护间隔 (ms) — 默认 15 分钟 */
  decayInterval: number;
  /** 对话历史超过此数量触发压缩 */
  compactionThreshold: number;
  /** 压缩后保留的完整对话轮数 */
  keepFullTurns: number;
  /** M2 存储保留的最大记录数（超出则 GC） */
  maxStorageRecords: number;
  /** 健康检查间隔 (ms) — 默认 15 秒 */
  healthCheckInterval: number;
  /** 事件循环延迟告警阈值 (ms) */
  eventLoopWarnThreshold: number;
}

const DEFAULT_CONFIG: MaintenanceConfig = {
  compactionInterval: 5 * 60 * 1000,      // 5 分钟
  gcInterval: 30 * 60 * 1000,             // 30 分钟
  decayInterval: 15 * 60 * 1000,          // 15 分钟
  compactionThreshold: 40,                 // 40 轮触发压缩
  keepFullTurns: 20,                       // 保留最近 20 轮完整
  maxStorageRecords: 500,                  // M2 最多 500 条
  healthCheckInterval: 15 * 1000,         // 15 秒
  eventLoopWarnThreshold: 200,            // 200ms 告警
};

// ──────────────────────────────────────────────
// 维护服务
// ──────────────────────────────────────────────

interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  /** ISO 时间戳（chat.ts 存储时写入，用于健康报告计算最早记录时间） */
  timestamp?: string;
}

export class MaintenanceService {
  private config: MaintenanceConfig;
  private startTime = Date.now();
  private lastCompaction: string | null = null;
  private lastGc: string | null = null;
  private eventLoopLag = 0;

  private compactionTimer: ReturnType<typeof setInterval> | null = null;
  private gcTimer: ReturnType<typeof setInterval> | null = null;
  private decayTimer: ReturnType<typeof setInterval> | null = null;

  // 外部依赖（由 server.ts 注入）
  private conversationHistory: ConversationTurn[] = [];
  private getConversationHistory: () => ConversationTurn[] = () => [];
  private setConversationHistory: (h: ConversationTurn[]) => void = () => {};
  private saveConversationHistory: () => void = () => {};
  private storage: AnyStorage | null = null;
  private runDecay: () => { total: number; archived: number } = () => ({ total: 0, archived: 0 });

  constructor(config?: Partial<MaintenanceConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // 启动事件循环延迟监测
    this.startEventLoopMonitor();
  }

  // ─── 注入依赖（由 server.ts 调用） ───

  injectDeps(deps: {
    conversationHistory: ConversationTurn[];
    getConversationHistory: () => ConversationTurn[];
    setConversationHistory: (h: ConversationTurn[]) => void;
    saveConversationHistory: () => void;
    storage: AnyStorage | (() => AnyStorage);
    /** 记忆衰减维护函数 */
    runDecay?: () => { total: number; archived: number };
    /** 知识库过期无分类条目清理（铁律：3个月无分类视为垃圾） */
    runKnowledgeGc?: () => number;
  }): void {
    this.conversationHistory = deps.conversationHistory;
    this.getConversationHistory = deps.getConversationHistory;
    this.setConversationHistory = deps.setConversationHistory;
    this.saveConversationHistory = deps.saveConversationHistory;
    this.storage = typeof deps.storage === 'function' ? null : deps.storage;
    if (typeof deps.storage === 'function') {
      this._storageGetter = deps.storage as () => AnyStorage;
    }
    if (deps.runDecay) this.runDecay = deps.runDecay;
    if (deps.runKnowledgeGc) this._runKnowledgeGc = deps.runKnowledgeGc;
  }

  private _runKnowledgeGc: () => number = () => 0;

  private _storageGetter: (() => AnyStorage) | null = null;

  // ─── 启动/停止 ───

  start(): void {
    console.log('[Maintenance] 启动维护引擎');

    // 对话压缩定时器
    this.compactionTimer = setInterval(() => {
      this.runCompaction().catch(e =>
        console.error('[Maintenance] 对话压缩失败:', e)
      );
    }, this.config.compactionInterval);

    // 存储 GC 定时器
    this.gcTimer = setInterval(() => {
      this.runGC().catch(e =>
        console.error('[Maintenance] 存储GC失败:', e)
      );
    }, this.config.gcInterval);

    // 知识库未分类条目 GC（3个月无分类彻底删除 — 铁律）
    setInterval(() => {
      try { const r = this._runKnowledgeGc(); if (r > 0) console.log('[Maintenance] 知识库GC: 清理 ' + r + ' 条过期未分类条目'); }
      catch (e) { console.error('[Maintenance] 知识库GC失败:', e); }
    }, 24 * 60 * 60 * 1000);

    // 记忆衰减定时器（15 分钟）
    this.decayTimer = setInterval(() => {
      const result = this.runDecay();
      if (result.total > 0) {
        console.log(`[Maintenance] 衰减维护: ${result.total}条, ${result.archived}条归档`);
      }
    }, this.config.decayInterval);

    // 首轮尽快执行
    setTimeout(() => this.runCompaction().catch(() => {}), 30_000);
    setTimeout(() => this.runGC().catch(() => {}), 60_000);
    setTimeout(() => {
      const result = this.runDecay();
      console.log(`[Maintenance] 首轮衰减: ${result.total}条, ${result.archived}条归档`);
    }, 90_000);
  }

  stop(): void {
    if (this.compactionTimer) clearInterval(this.compactionTimer);
    if (this.gcTimer) clearInterval(this.gcTimer);
    if (this.decayTimer) clearInterval(this.decayTimer);
    console.log('[Maintenance] 维护引擎已停止');
  }

  // ─── 健康报告 ───

  getHealth(): HealthReport {
    const mem = process.memoryUsage();
    const history = this.getConversationHistory();
    // 从历史记录中取最早的非空 timestamp 计算距今小时数
    let oldest = 0;
    for (const t of history) {
      if (t.timestamp) {
        const age = (Date.now() - new Date(t.timestamp).getTime()) / 3600000;
        if (age > oldest) oldest = Math.round(age);
      }
    }

    return {
      status: this.eventLoopLag > this.config.eventLoopWarnThreshold ? 'degraded' : 'ok',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      memory: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
        rssMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      },
      conversations: {
        total: history.length,
        oldestAgeHours: oldest,
      },
      storage: {
        totalRecords: 0,   // 由外部填充
        totalSizeKB: 0,
      },
      lastMaintenance: {
        compaction: this.lastCompaction,
        gc: this.lastGc,
      },
      eventLoopLag: this.eventLoopLag,
    };
  }

  /** 由外部更新 storage 统计（当前暂未启用 — 由 getHealth 直接计算） */

  // ─── 对话压缩 ───

  /**
   * 当对话历史超过阈值时，将最早的 half 压缩为摘要。
   * 保留最近 keepFullTurns 条完整对话。
   *
   * 压缩策略：将连续多轮 user/assistant 对话合并为一条概括性文本。
   * 如果已经压缩过的摘要再次被压缩，会进一步合并。
   */
  async runCompaction(): Promise<void> {
    const history = this.getConversationHistory();
    if (history.length <= this.config.compactionThreshold) {
      return; // 未达阈值，无需压缩
    }

    const keep = this.config.keepFullTurns;
    const toCompact = history.slice(0, history.length - keep);
    const remaining = history.slice(history.length - keep);

    // 将旧对话压缩为摘要轮次
    const summaries = this.compressTurns(toCompact);

    // 如果之前已有摘要，追加到新摘要前面
    const compacted: ConversationTurn[] = [
      ...summaries,
      ...remaining,
    ];

    this.setConversationHistory(compacted);
    this.saveConversationHistory();

    this.lastCompaction = new Date().toISOString();
    console.log(
      `[Maintenance] 对话压缩: ${history.length} → ${compacted.length} 条 ` +
      `(压缩 ${history.length - compacted.length} 条)`
    );
  }

  /**
   * 将一批对话轮次压缩为摘要轮次。
   * 每 4 轮（2 问 2 答）合并为一条 "user: 摘要" + "assistant: 摘要"。
   */
  private compressTurns(turns: ConversationTurn[]): ConversationTurn[] {
    const result: ConversationTurn[] = [];
    const CHUNK_SIZE = 4;

    for (let i = 0; i < turns.length; i += CHUNK_SIZE) {
      const chunk = turns.slice(i, i + CHUNK_SIZE);
      const userParts: string[] = [];
      const assistantParts: string[] = [];

      for (const turn of chunk) {
        const text = turn.content.length > 60
          ? turn.content.substring(0, 60) + '…'
          : turn.content;
        if (turn.role === 'user') userParts.push(text);
        else assistantParts.push(text);
      }

      if (userParts.length > 0) {
        result.push({
          role: 'user',
          content: `[历史摘要] ${userParts.join(' | ')}`,
        });
      }
      if (assistantParts.length > 0) {
        result.push({
          role: 'assistant',
          content: `[历史摘要] ${assistantParts.join(' | ')}`,
        });
      }
    }

    return result;
  }

  // ─── 存储 GC ───

  /**
   * 清理 M2 存储中过旧的记录。
   * 保留最近 maxStorageRecords 条（按 seq_pos 截断）。
   * FusionStorageAdapter 已基于 SQLite，支持删除操作。
   */
  async runGC(): Promise<void> {
    // 使用 getter 或直接引用的 storage
    const st = this.storage ?? (this._storageGetter?.() ?? null);
    if (!st) return;

    try {
      const status = await st.getStatus();
      const total = status.totalRecords;

      if (total <= this.config.maxStorageRecords) {
        return; // 未达阈值
      }

      // M2 已使用 SQLite（FusionStorageAdapter），支持删除操作。
      // 实际删除需注入 storage 的具体接口（findBySeqPosRange + writeRaw），
      // 当前 runGC 仅记录告警。如需激活，将 FusionStorageAdapter 传入
      // injectDeps 并在 runGC 中调用 sqlite.writeRaw('DELETE FROM memories ...')。
      console.log(
        `[Maintenance] M2 存储 ${total} 条，超过阈值 ${this.config.maxStorageRecords}。` +
        `（当前 GC 仅检测，未执行删除——如需激活请在 injectDeps 中传入 storage 完整接口）`
      );

      this.lastGc = new Date().toISOString();
    } catch (err) {
      console.error('[Maintenance] 存储状态检查失败:', err);
    }
  }

  // ─── 事件循环延迟监测 ───

  private startEventLoopMonitor(): void {
    let lastCheck = Date.now();
    setInterval(() => {
      const now = Date.now();
      this.eventLoopLag = now - lastCheck - 1000; // 1s 间隔
      lastCheck = now;
    }, 1000).unref();
  }

  // ─── 手动触发 ───

  async triggerCompaction(): Promise<{ before: number; after: number }> {
    const before = this.getConversationHistory().length;
    await this.runCompaction();
    const after = this.getConversationHistory().length;
    return { before, after };
  }
}
