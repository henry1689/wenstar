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
  compactionThreshold: 200,                // 200 轮触发压缩（之前40太小，一超20轮就吞原文）
  keepFullTurns: 100,                      // 保留最近 100 轮完整原文
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
  private _sqliteGetter: (() => any | null) | null = null;
  private familyGraph: any | null = null;
  private _fgGetter: (() => any) | null = null;

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
    /** 砂金库→金库关联：压缩时查 M2 是否已存（提供 SQLite queryAll） */
    _sqliteGetter?: () => any | null;
    /** 家族图谱主库（双写人名抢救用） */
    familyGraph?: any;
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
    if (deps._sqliteGetter) this._sqliteGetter = deps._sqliteGetter;
    if (deps.familyGraph) {
      this.familyGraph = typeof deps.familyGraph === 'function' ? null : deps.familyGraph;
      if (typeof deps.familyGraph === 'function') {
        this._fgGetter = deps.familyGraph as () => any;
      }
    }
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
      // (v1.1) 同步清理 FG 过期 pending 条目（30天TTL）
      try {
        const fg = this.familyGraph ?? (this._fgGetter ? this._fgGetter() : null);
        if (fg && typeof fg.cleanExpiredPendingItems === 'function') {
          const r = fg.cleanExpiredPendingItems();
          if (r > 0) console.log('[Maintenance] FG pending清理: ' + r + ' 条');
        }
      } catch (e) { console.warn('[Maintenance] FG pending清理失败:', e); }
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

    // 获取 SQLite（用于检测 M2 中是否已存）
    const sqlite = this._sqliteGetter ? this._sqliteGetter() : null;

    // 将旧对话压缩为摘要轮次（带 M2 关联检测）
    const summaries = await this.compressTurnsSmart(toCompact, sqlite);

    // 如果之前已有摘要，追加到新摘要前面
    const compacted: ConversationTurn[] = [
      ...summaries,
      ...remaining,
    ];

    this.setConversationHistory(compacted);
    this.saveConversationHistory();

    // 砂金库同步：压缩后清理 SQLite 旧数据 + 写入摘要
    if (this._sqliteGetter) {
      try {
        const sqlite = this._sqliteGetter();
        if (sqlite) {
          const firstTs = toCompact.length > 0 ? (toCompact[0].timestamp || new Date().toISOString()) : new Date().toISOString();
          const lastTs = toCompact.length > 0 ? (toCompact[toCompact.length - 1].timestamp || new Date().toISOString()) : new Date().toISOString();
          if (summaries.length > 0) {
            const summaryText = summaries.map(function(s) { return s.content; }).filter(Boolean).join(' | ');
            if (summaryText) {
              sqlite.insertConversation('assistant', '【对话摘要】' + summaryText.substring(0, 200), { seqPos: 0 });
            }
          }
          const cutoff = remaining.length > 0 ? remaining[0].timestamp : null;
          // 安全保护：没有timestamp时不清理（防止误删全库）
          if (cutoff) {
            sqlite.writeRaw('DELETE FROM conversations WHERE timestamp < ? AND is_summary = 0', [cutoff]);
            console.log('[Maintenance] 清理 < ' + cutoff);
          }
        }
      } catch (e) {
        console.warn('[Maintenance] 砂金库同步失败:', e);
      }
    }

    this.lastCompaction = new Date().toISOString();
    console.log(
      `[Maintenance] 对话压缩: ${history.length} → ${compacted.length} 条 ` +
      `(压缩 ${history.length - compacted.length} 条)`
    );
  }

  /**
   * 智能压缩 — 关联 M2 金库检测。
   * 已存入 M2 的记忆标记为"(已存金库)"并保留摘要头，
   * 未存的日常对话直接丢弃（释放空间）。
   *
   * 🔴 人名抢救：压缩前全文本扫描所有用户对话，提取姓+名/阿X/小X
   *    并写入 entity_relations 表，防止压缩后永久丢失。
   *    比如"熊勇说""熊梓玥今天""跟徐诗雨""阿珍她"等句式漏掉的人名。
   */
  private async compressTurnsSmart(turns: ConversationTurn[], sqlite: any | null): Promise<ConversationTurn[]> {
    // ── 人名抢救：压缩前全文本扫描 ──
    this.rescueNamesBeforeCompression(turns, sqlite, this.familyGraph);

    const result: ConversationTurn[] = [];
    const CHUNK_SIZE = 20; // LLM 批量摘要：20轮一组

    for (let i = 0; i < turns.length; i += CHUNK_SIZE) {
      const chunk = turns.slice(i, i + CHUNK_SIZE);
      const userTexts = chunk.filter(function(t) { return t.role === 'user'; }).map(function(t) { return t.content; });
      const combinedUser = userTexts.join('').substring(0, 60);
      if (!combinedUser.trim()) continue;

      // 查 M2：这条对话的关键词是否已被巩固为情感记忆
      let inGold = false;
      if (sqlite && combinedUser.length > 4) {
        try {
          const keyword = combinedUser.substring(0, 20).replace(/[^一-鿿\w]/g, '');
          if (keyword.length > 1) {
            const rows = sqlite.queryAll(
              `SELECT COUNT(*) as cnt FROM memories WHERE raw_input LIKE ?`,
              [`%${keyword}%`]
            );
            inGold = (rows?.[0]?.cnt ?? 0) > 0;
          }
        } catch { /* sqlite 不可用，降级为无检测压缩 */ }
      }

      if (inGold) {
        result.push({ role: 'user', content: `(已存金库) ${combinedUser.substring(0, 40)}` });
      } else {
        // 未存金库但有人类对话 → 生成摘要（LLM可用时使用LLM，否则用规则摘要）
        const allContent = chunk.map(function(t) { return t.content; }).filter(Boolean).join(' ');
        if (allContent.length > 10) {
          // 规则摘要：取关键内容，控制长度
          var summary = allContent.substring(0, 80);
          if (allContent.length > 80) summary += '…';
          result.push({ role: 'user', content: '【历史对话】' + summary });
        }
      }
    }

    console.log(`[Compaction] 智能压缩: ${turns.length} 轮 → ${result.length} 条摘要`);
    return result;
  }

  /** 旧版压缩方法已替换为 compressTurnsSmart（保留 `已存金库` 检测） */

  /**
   * 🔴 人名抢救：在对话压缩前，全文本扫描所有用户轮次，
   * 提取中文人名（姓+名、阿X、小X）并写入 entity_relations 和 knowledge_base，
   * 防止压缩后原始对话丢失导致人名永久遗漏。
   */
  private rescueNamesBeforeCompression(turns: ConversationTurn[], sqlite: any | null, fg?: any | null): void {
    if (!sqlite) return;
    // 惰性解析：如果传 null 但存在 getter，取一次
    const familyGraph = fg ?? (this._fgGetter ? this._fgGetter() : null);
    const now = new Date().toISOString();
    const SURNAMES_SET = new Set(
      '赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公'
    );
    // 停用字（名字后跟这些字说明不是名字的完整部分）
    const TRAILING_STOP = new Set('昨今明去来也和就都在这那而已了过');

    function isName(t: string): boolean {
      if (t.length < 2 || t.length > 3) return false;
      if (t.length === 2 && t[0] === '阿' && /[一-龥]/.test(t[1]) && !TRAILING_STOP.has(t[1])) return true;
      if (t.length === 2 && (t[0] === '老' || t[0] === '小') && /[一-龥]/.test(t[1]) && !TRAILING_STOP.has(t[1])) return true;
      return SURNAMES_SET.has(t[0]);
    }

    // 是否长词误匹配
    function isCompoundWord(name: string, text: string): boolean {
      const GRAMMAR_WORDS = new Set('是说和的了在也都就来还要会能不很太把被让给对用从向跟与有没做走来看听等呢吗啊吧着过到比');
      const idx = text.indexOf(name);
      if (idx < 0) return false;
      // 只检查后字：后跟中文且不是常见语法词 → 可能是复合词，拦截
      const afterIdx = idx + name.length;
      if (afterIdx < text.length) { const nxt = text[afterIdx]; if (/[一-龥]/.test(nxt) && !GRAMMAR_WORDS.has(nxt)) return true; }
      return false;
    }

    const allText = turns.filter(t => t.role === 'user').map(t => t.content).join('\n');
    if (!allText.trim()) return;

    // 正则：姓氏+1~2字名 | 阿X | 老X | 小X
    const nameRegex = /([赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公][一-龥]{1,2}|阿[一-龥]|小[一-龥])/g;
    const rawMatches = allText.match(nameRegex);
    if (!rawMatches) return;

    // 裁剪末尾语法词："熊勇是"→"熊勇"
    const GRAMMAR_WORDS = new Set('是说和的了在也都就来还要会能不很太把被让给对用从向跟与有没做走来看听等呢吗啊吧着过到比');
    const matches = [...new Set(rawMatches)].map(n => {
      while (n.length > 2 && GRAMMAR_WORDS.has(n[n.length - 1])) n = n.slice(0, -1);
      return n;
    }).filter(n => n.length >= 2);

    const seen = new Set<string>();
    let rescued = 0;
    for (const rawName of matches) {
      if (seen.has(rawName)) continue;
      seen.add(rawName);
      if (isCompoundWord(rawName, allText)) continue;

      // 检查是否已存在于 entities
      try {
        const existing = sqlite.queryAll('SELECT id FROM entities WHERE name = ? AND type = ?', [rawName, 'person']);
        if (existing.length > 0) continue; // 已有记录，跳过

        // 写入 entities
        sqlite.writeRaw('INSERT OR IGNORE INTO entities (name, type) VALUES (?, ?)', rawName, 'person');
        sqlite.writeRaw('INSERT OR IGNORE INTO entities (name, type) VALUES (?, ?)', '我', 'self');

        // 写入 entity_relations
        const meRows = sqlite.queryAll('SELECT id FROM entities WHERE name = ? AND type = ?', ['我', 'self']);
        const personRows = sqlite.queryAll('SELECT id FROM entities WHERE name = ? AND type = ?', [rawName, 'person']);
        if (meRows.length > 0 && personRows.length > 0) {
          sqlite.writeRaw(
            'INSERT INTO entity_relations (entity_a_id, entity_b_id, relation, strength, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(entity_a_id, entity_b_id, relation) DO UPDATE SET strength = MIN(5.0, excluded.strength + 0.1), updated_at = excluded.updated_at',
            meRows[0].id, personRows[0].id, '认识的人', 0.3, now
          );
          // (FG-迁移) 双写 FamilyGraph
          if (familyGraph) {
            try { familyGraph.integrateSocialRelation(rawName, 'acquaintance_of', allText).catch(() => {}); } catch {}
          }
        }

        // 知识库不再存人（已废弃，人物统一归家族图谱）
        rescued++;
        console.log(`[Compaction] 人名抢救: ${rawName}`);
      } catch (err) {
        console.warn(`[Compaction] 人名抢救失败 ${rawName}:`, err);
      }
    }
    if (rescued > 0) console.log(`[Compaction] 人名抢救完成: ${rescued} 人`);
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
