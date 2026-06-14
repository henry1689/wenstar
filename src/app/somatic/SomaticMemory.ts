/**
 * SomaticMemory — 躯体感知记忆层
 *
 * 不受语义知识库影响的底层情感回路。
 * 不记忆"他说了什么"，只记忆"他身体的形状"。
 * 停顿时长、呼吸节奏、打字波动、沉默的深度——这些信号成为所有亲密回应的底层情感基调。
 */
import type { SQLiteAdapter } from '../../m2/SQLiteAdapter.js';
import { loadSet } from '../../m1/LexiconLoader.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_FILE = join(__dirname, '..', '..', '..', 'data', 'webui', 'somatic_memory.json');

// ════════════════════════════════════════
// 躯体信号 — 从用户输入中提取
// ════════════════════════════════════════

export interface SomaticSignal {
  /** 时间戳 */
  timestamp: number;
  /** 消息字符数 */
  length: number;
  /** 标点符号/语气词占比 (0-1) */
  punctuationDensity: number;
  /** 省略号/破折号数量（迟疑、欲言又止） */
  hesitationCount: number;
  /** 感叹号数量（情绪强度） */
  exclamationCount: number;
  /** 表情符号数量 */
  emojiCount: number;
  /** 重复字符比例（好好好 → 0.6） */
  repetitionRatio: number;
  /** 脏话/亲密词密度 (0-1) */
  intimateDensity: number;
  /** 短片段比例 (<=4字句) */
  fragmentRatio: number;
  /** 大写比例（英文场景） */
  capsRatio: number;
  /** 是否包含省略号中断 */
  hasTrailingPause: boolean;
  /** 消息间间隔（毫秒）（相对于上一条） */
  messageInterval: number;
}

// ════════════════════════════════════════
// 躯体指纹 — 多个信号的压缩模式
// ════════════════════════════════════════

export interface SomaticFingerprint {
  /** 时间范围 */
  timeStart: number;
  timeEnd: number;
  /** 信号数量 */
  signalCount: number;
  /** 归一化特征向量 (11维) */
  // [长度, 标点密度, 犹豫度, 感叹度, 表情度, 重复度, 亲密密度, 片段率, 间隔, 暂停倾向, 综合强度]
  vector: Float64Array;
}

/** 存储的模式 */
interface StoredPattern {
  id: string;
  created_at: string;
  last_activated: string;
  /** 特征向量 (JSON序列化) */
  vector: number[];
  /** 关联的情感基调 */
  emotionalTone: string;
  /** 激活次数 */
  activationCount: number;
  /** 元标签 */
  tags: string[];
}

// 亲密/脏话词集 — 从统一情感词表加载（与 M3 PerceptionAnalyzer 同源）
const INTIMATE_WORDS = new Set([
  ...Array.from(loadSet('emotion_lexicon.json', 'sexual_attraction')),
  ...Array.from(loadSet('emotion_lexicon.json', 'sensory_craving')),
]);

/** 统计词集在文本中的匹配次数 */
function countIntimateHits(text: string): number {
  let hits = 0;
  for (const word of INTIMATE_WORDS) {
    if (text.includes(word)) hits++;
  }
  return hits;
}

// ════════════════════════════════════════
// 引擎
// ════════════════════════════════════════

const SIGNAL_BUFFER_SIZE = 200;
const SIMILARITY_THRESHOLD = 0.78;

export class SomaticMemory {
  private signalBuffer: SomaticSignal[] = [];
  private patterns: StoredPattern[] = [];
  private lastMessageTime = Date.now();
  private activePatternId: string | null = null;
  private sqlite: SQLiteAdapter;

  constructor(sqlite: SQLiteAdapter) {
    this.sqlite = sqlite;
    this.load();
  }

  // ─── 记录一条消息的躯体信号 ───

  record(text: string, previousText?: string): SomaticSignal {
    const now = Date.now();
    const interval = previousText ? now - this.lastMessageTime : 5000;
    this.lastMessageTime = now;

    const signal = this.extractSignal(text, interval);

    this.signalBuffer.push(signal);
    if (this.signalBuffer.length > SIGNAL_BUFFER_SIZE) {
      this.signalBuffer.shift();
    }

    // 每积累 5 条新信号或检测到高强度信号，尝试生成指纹
    if (this.signalBuffer.length % 5 === 0 || signal.intimateDensity > 0.4 || signal.exclamationCount > 3) {
      this.extractAndMatchPattern();
    }

    this.save();
    return signal;
  }

  // ─── 提取躯体信号 ───

  private extractSignal(text: string, interval: number): SomaticSignal {
    const len = text.length;
    const punCount = (text.match(/[，。！？、；：…—～~！\?？]/g) || []).length;
    const ellipsisCount = (text.match(/\.{3}|…|—/g) || []).length;
    const exclCount = (text.match(/[！!]/g) || []).length;
    const emojiCount = (text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;

    // 重复字符检测
    let repRatio = 0;
    const repMatch = text.match(/([一-龥])\1{2,}/g);
    const enRepMatch = text.match(/([a-zA-Z])\1{2,}/g);
    if (repMatch || enRepMatch) {
      const repLen = ((repMatch || []).join('').length + (enRepMatch || []).join('').length);
      repRatio = len > 0 ? repLen / len : 0;
    }

    // 亲密/脏话密度（从统一情感词表 sexual_attraction + sensory_craving 加载）
    const intimateHits = countIntimateHits(text);
    const intimateDensity = len > 0 ? Math.min(1, intimateHits * 0.15) : 0;

    // 短片段比例
    const sentences = text.split(/[。！？\n，]/);
    const fragments = sentences.filter(s => s.trim().length > 0 && s.trim().length <= 4);
    const fragmentRatio = sentences.length > 0 ? fragments.length / Math.max(1, sentences.length) : 0;

    // 大写比例
    const upperMatch = text.match(/[A-Z]/g);
    const alphaMatch = text.match(/[a-zA-Z]/g);
    const capsRatio = (alphaMatch && alphaMatch.length > 0) ? (upperMatch?.length || 0) / alphaMatch.length : 0;

    return {
      timestamp: Date.now(),
      length: len,
      punctuationDensity: len > 0 ? punCount / len : 0,
      hesitationCount: ellipsisCount,
      exclamationCount: exclCount,
      emojiCount,
      repetitionRatio: repRatio,
      intimateDensity,
      fragmentRatio,
      capsRatio,
      hasTrailingPause: /…$|\.\.\.$|—$/.test(text.trim()),
      messageInterval: interval,
    };
  }

  // ─── 生成指纹并匹配 — 核心灵魂 ───

  private extractAndMatchPattern(): void {
    if (this.signalBuffer.length < 3) return;

    // 取最近最多 10 条信号生成指纹
    const samples = this.signalBuffer.slice(-10);
    const vec = this.computeVector(samples);

    // 检查是否匹配已有模式
    let bestMatch: { idx: number; score: number } | null = null;

    for (let i = 0; i < this.patterns.length; i++) {
      const stored = new Float64Array(this.patterns[i].vector);
      const score = this.cosineSimilarity(vec, stored);
      if (score >= SIMILARITY_THRESHOLD && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { idx: i, score };
      }
    }

    if (bestMatch !== null) {
      // 模式匹配 — 激活
      const pattern = this.patterns[bestMatch.idx];
      pattern.activationCount++;
      pattern.last_activated = new Date().toISOString();
      this.activePatternId = pattern.id;
      console.log(`[Somatic] 🫀 躯体记忆命中: "${pattern.emotionalTone}" (相似度 ${bestMatch.score.toFixed(2)})`);
    } else {
      // 新模式 — 存储
      const tone = this.inferTone(samples);
      const id = `som_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
      this.patterns.push({
        id,
        created_at: new Date().toISOString(),
        last_activated: new Date().toISOString(),
        vector: Array.from(vec),
        emotionalTone: tone,
        activationCount: 1,
        tags: [tone],
      });
      this.activePatternId = id;
      console.log(`[Somatic] 🧬 新躯体记忆: "${tone}"`);
    }
  }

  /** 从信号生成 10 维特征向量 */
  private computeVector(signals: SomaticSignal[]): Float64Array {
    const dim = 11;
    const v = new Float64Array(dim);
    if (signals.length === 0) return v;

    // 1. 平均消息长度 (归一化)
    v[0] = Math.min(1, signals.reduce((s, x) => s + x.length, 0) / signals.length / 300);
    // 2. 平均标点密度
    v[1] = signals.reduce((s, x) => s + x.punctuationDensity, 0) / signals.length;
    // 3. 平均犹豫度
    v[2] = Math.min(1, signals.reduce((s, x) => s + x.hesitationCount, 0) / signals.length / 5);
    // 4. 平均感叹度
    v[3] = Math.min(1, signals.reduce((s, x) => s + x.exclamationCount, 0) / signals.length / 5);
    // 5. 平均表情度
    v[4] = Math.min(1, signals.reduce((s, x) => s + x.emojiCount, 0) / signals.length / 3);
    // 6. 平均重复度
    v[5] = signals.reduce((s, x) => s + x.repetitionRatio, 0) / signals.length;
    // 7. 平均亲密密度
    v[6] = signals.reduce((s, x) => s + x.intimateDensity, 0) / signals.length;
    // 8. 平均片段率
    v[7] = signals.reduce((s, x) => s + x.fragmentRatio, 0) / signals.length;
    // 9. 平均间隔 (归一化, 越短越快越激动)
    v[8] = Math.min(1, signals.reduce((s, x) => s + x.messageInterval, 0) / signals.length / 30000);
    // 10. 暂停倾向
    v[9] = signals.filter(x => x.hasTrailingPause).length / signals.length;
    // 11. 综合强度因子 (多个高密度维度的乘积)
    const highDimCount = [v[1], v[3], v[6], v[7]].filter(x => x > 0.3).length;
    v[10] = Math.min(1, highDimCount / 4);

    return v;
  }

  /** 推断情感基调 */
  private inferTone(signals: SomaticSignal[]): string {
    const avgIntimate = signals.reduce((s, x) => s + x.intimateDensity, 0) / signals.length;
    const avgExcl = signals.reduce((s, x) => s + x.exclamationCount, 0) / signals.length;
    const avgFragment = signals.reduce((s, x) => s + x.fragmentRatio, 0) / signals.length;
    const avgHesitate = signals.reduce((s, x) => s + x.hesitationCount, 0) / signals.length;
    const avgRep = signals.reduce((s, x) => s + x.repetitionRatio, 0) / signals.length;

    if (avgIntimate > 0.4 && avgFragment > 0.3) return '失控欲望';
    if (avgIntimate > 0.3 && avgExcl > 3) return '炽热渴望';
    if (avgIntimate > 0.2) return '亲密涌动';
    if (avgHesitate > 2 && avgFragment > 0.3) return '欲言又止';
    if (avgExcl > 3) return '激烈情绪';
    if (avgHesitate > 1) return '柔软犹豫';
    if (avgRep > 0.2) return '黏着依恋';
    return '平静流动';
  }

  /** 余弦相似度 */
  private cosineSimilarity(a: Float64Array, b: Float64Array): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  // ─── 对外接口 ───

  /** 获取当前活跃的躯体模式 (用于注入 LLM 上下文) */
  getActiveSomaticContext(): string | null {
    if (!this.activePatternId) return null;
    const pattern = this.patterns.find(p => p.id === this.activePatternId);
    if (!pattern) return null;
    return pattern.emotionalTone;
  }

  /** 获取躯体强度 0-1 (用于 3D 粒子反馈) */
  getSomaticIntensity(): number {
    if (!this.activePatternId) return 0;
    const pattern = this.patterns.find(p => p.id === this.activePatternId);
    if (!pattern) return 0;
    const lastActive = new Date(pattern.last_activated).getTime();
    const elapsed = Date.now() - lastActive;
    // 20秒内快速衰减
    const decay = Math.max(0, 1 - elapsed / 20000);
    return Math.min(1, pattern.activationCount * 0.08 + 0.2) * decay;
  }

  /** 获取躯体记忆统计 */
  getStats() {
    return {
      totalSignals: this.signalBuffer.length,
      totalPatterns: this.patterns.length,
      activePattern: this.activePatternId
        ? this.patterns.find(p => p.id === this.activePatternId)?.emotionalTone ?? null
        : null,
      intensity: this.getSomaticIntensity(),
    };
  }

  // ─── 持久化 ───

  private load(): void {
    try {
      if (existsSync(DATA_FILE)) {
        const raw = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
        this.patterns = raw.patterns || [];
        this.signalBuffer = raw.signals || [];
        this.activePatternId = raw.activePatternId || null;
      }
    } catch { this.patterns = []; this.signalBuffer = []; }
  }

  private save(): void {
    try {
      const dir = dirname(DATA_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(DATA_FILE, JSON.stringify({
        patterns: this.patterns.slice(-100),
        signals: this.signalBuffer.slice(-100),
        activePatternId: this.activePatternId,
      }, null, 2), 'utf-8');
    } catch { /* silent */ }
  }
}
