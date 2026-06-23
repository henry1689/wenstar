/**
 * config.ts — 系统集中配置
 *
 * 白皮书 §2.1 系统分层图和执行协议 §1.1 的标准开发闭环要求
 * 集中管理所有可调参数。当前版本仅声明默认值，不强制迁移现有代码。
 *
 * 使用方式:
 *   import { config } from './config.js';
 *   if (someValue > config.m9.graduateCycleMax) { ... }
 *
 * Ref: 战略性改善建议 — 集中配置管理
 */
export const config = {
  /** ── 系统路径 ── */
  paths: {
    dataDir: 'data/webui',
    lexiconsDir: 'data/lexicons',
  },

  /** ── M1 DNA编码 ── */
  m1: {
    taxonomyPath: 'config/taxonomy_v1.json',
    selfModelPath: 'config/self_model_v1.json',
  },

  /** ── M2 融合记忆 ── */
  m2: {
    /** SQLite 默认数据库路径 */
    dbName: 'fusion_memory.db',
    /** 情感检索遍历上限 */
    maxRecallCandidates: 200,
    /** 批量 flush 次数阈值 */
    flushBatchSize: 5,
    /** 最长 flush 间隔 (ms) */
    flushInterval: 2000,
  },

  /** ── M3 24维感知 ── */
  m3: {
    hitReportEnabled: true,
  },

  /** ── M4 知识融合 ── */
  m4: {
    /** 关键词全文搜索候选数 */
    keywordSearchLimit: 200,
    /** 情感检索默认返回数 */
    emotionalRetrievalLimit: 5,
    /** 时序检索默认返回数 */
    seqRetrievalLimit: 50,
    /** 衰减门控最低强度 */
    minStrength: 0.05,
  },

  /** ── M5 表达生成 ── */
  m5: {
    /** 对话历史最大轮次 */
    maxHistoryTurns: 200,
    /** 最近回复去重池大小 */
    recentReplyPool: 20,
    /** MockLLM 亲密基线初始值 */
    mockIntimacyBaseline: 0.3,
    /** MockLLM 每轮亲密增量 */
    mockIntimacyIncrement: 0.08,
  },

  /** ── M6 自我模型 ── */
  m6: {
    /** 维护间隔 (ms) */
    maintenanceInterval: 15 * 60 * 1000,
    /** 自动演化最低反馈次数 */
    minFeedbackCount: 5,
    /** 大幅演化阈值 (%) */
    largeEvolutionDelta: 15,
  },

  /** ── M7 梦境引擎 ── */
  m7: {
    /** 批处理间隔 (ms) */
    batchInterval: 60_000,
    /** 梦境队列上限 */
    maxDreamQueue: 20,
    /** 丢弃未处理的天数 */
    staleDays: 7,
    /** 批量处理触发条数 */
    batchThreshold: 10,
    /** 单条超时 (小时) */
    singleTimeoutHours: 24,
  },

  /** ── M8 年轮引擎 ── */
  m8: {
    /** 线索检索返回上限 */
    clueRetrievalLimit: 5,
    /** 关键词检索候选数 */
    keywordCandidates: 50,
    /** 愈合检测天数 */
    healingDays: 30,
  },

  /** ── M9 工作记忆 ── */
  m9: {
    /** 缓冲上限 */
    maxBufferSize: 50,
    /** 刷出间隔 (ms) */
    flushInterval: 60_000,
    /** 液体级最长停留轮数 */
    graduateCycleMax: 3,
    /** 无实体条目最长停留轮数 */
    discardCycleMax: 2,
    /** 安全阀强制处理轮数 */
    forceGraduateCycle: 6,
  },

  /** ── 后台维护 ── */
  maintenance: {
    compactionInterval: 5 * 60 * 1000,
    gcInterval: 30 * 60 * 1000,
    decayInterval: 15 * 60 * 1000,
    compactionThreshold: 40,
    keepFullTurns: 20,
    maxStorageRecords: 500,
    healthCheckInterval: 15_000,
    eventLoopWarnThreshold: 200,
  },

  /** ── 谱曲引擎 (8100) ── */
  composer: {
    apiUrl: 'http://localhost:8100/api/v1/emotion',
    timeout: 5000,
  },

  /** ── 仿生智脑 (7200) ── */
  bionic: {
    apiUrl: 'http://localhost:7200/api/v1',
    timeout: 5000,
  },

  /** ── TTS 语音 (8765) ── */
  tts: {
    apiUrl: 'http://localhost:8765',
  },

  /** ── T1: 太虚图书馆（旗舰版）── */
  library: {
    enabled: process.env["TAIXU_LIBRARY_ENABLED"] === "true",
    port: parseInt(process.env["TAIXU_LIBRARY_PORT"] ?? "3737", 10),
    dataDir: "lib/taixu-library/data",
    watchDir: "lib/taixu-library/data/watch",
    syncInterval: 300_000,
    autoInit: true,
  },
} as const;

export type Config = typeof config;
