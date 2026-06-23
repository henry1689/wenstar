// Ref: ARCH.md §3.2 写入正向流: L0 → L1 → L2 → L3 逐层生成
// Ref: ARCH.md §3.2 无DNA不写入 — 未经编码器的碎片禁止进入存储区
// Ref: 架构决策备忘录 v1.3 — 叶子节点存储粒度为"最小语义单位"

import { createHash } from 'node:crypto';
import { routeL0, loadTaxonomy } from './L0Router.js';
import { L1Sequencer } from './L1Sequencer.js';
import { L2ContentExtractor } from './L2ContentExtractor.js';
import { L3EntityAnnotator } from './L3EntityAnnotator.js';
import { SemanticBoundaryDetector } from './SemanticBoundaryDetector.js';
import type {
  DNA,
  TaxonomyTree,
  SelfModelV1,
  L0RouteResult,
  L1SequenceResult,
  L2ContentResult,
  L3AnnotationResult,
} from './types/dna.js';

/** 流式输入的单个片段 */
export interface PushInput {
  utterance: string;
  context?: string[];
  timestamp?: string;
}

/** 缓冲中的片段 */
interface BufferEntry {
  utterance: string;
  context: string;
  timestamp?: string;
}

/**
 * DNA 编码器编排器（流式模式）
 *
 * 严格按照 L0 → L1 → L2 → L3 的顺序流水线，逐层生成 DNA 对象。
 * 采用 push/flush 流式缓冲模式，自动检测语义边界，
 * 确保每个叶子节点存储的是一个"最小语义单位"而非文字碎片。
 *
 * API 三层：
 * - push()    — 流式推入，自动缓冲/自动flush
 * - flush()   — 强制结束当前语义单位
 * - encodeSingle() / encodeBatch() — 非流式快捷调用
 *
 * Ref: ARCH.md §3.2 编码与还原规则
 * Ref: 架构决策备忘录 v1.3
 */
export class DNAEncoder {
  private selfModel: SelfModelV1;
  private sequencer: L1Sequencer;
  private extractor: L2ContentExtractor;
  private annotator: L3EntityAnnotator;
  private detector: SemanticBoundaryDetector;
  private taxonomy: TaxonomyTree | null = null;

  /** 当前语义单位的缓冲 */
  private buffer: BufferEntry[] = [];
  /** M1 运行时统计 */
  private stats = { encodeCount: 0, failCount: 0, stageFailures: { l0: 0, l1: 0, l2: 0, l3: 0 } };

  /** SP2-1: 当日流水号计数器（每日重置） */
  private static _dailySeq = 0;
  private static _lastDate = '';

  /**
   * SP2-1: 生成 DNA 物料根码
   * 完整格式: DNA-YYYYMMDD-HHmm-NNNN-X
   * X = HY瑶印码（1位hex，SHA256取末位，同一日期一致）
   */
  static generateRootId(userId?: string): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateStr = `${y}${m}${d}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

    if (DNAEncoder._lastDate !== dateStr) {
      DNAEncoder._dailySeq = 0;
      DNAEncoder._lastDate = dateStr;
    }
    DNAEncoder._dailySeq++;
    const seq = String(DNAEncoder._dailySeq).padStart(4, '0');

    // HY 瑶印码: SHA256( HY + 日期 ) → 末位 hex 字符
    const hyStamp = DNAEncoder.generateHYStamp(dateStr);
    return `DNA-${dateStr}-${timeStr}-${seq}-${hyStamp}`;
  }

  /**
   * SP2-1: 生成环节特征码
   * 格式: {根码}.{模块代码}.{流水号}
   * 模块代码: M1/M3/MEM/BD/GRAPH
   */
  static generateSubId(rootId: string, moduleCode: string, seqNo: number = 1): string {
    return `${rootId}.${moduleCode}.${String(seqNo).padStart(3, '0')}`;
  }

  /**
   * HY 瑶印码生成 — SHA256 末位 hex 字符
   * 拼接固定前缀 "HY" + 8位日期 → SHA256 → 取末位 hex
   * 同一日期产出始终一致，外人无法反推 HY 含义
   */
  static generateHYStamp(dateStr: string): string {
    const input = `HY${dateStr}`;
    const hash = createHash('sha256').update(input, 'utf8').digest('hex');
    return hash.charAt(hash.length - 1).toUpperCase();
  }

  constructor(selfModel: SelfModelV1) {
    this.selfModel = selfModel;
    this.sequencer = new L1Sequencer();
    this.extractor = new L2ContentExtractor();
    this.annotator = new L3EntityAnnotator();
    this.detector = new SemanticBoundaryDetector();
  }

  /**
   * 注入外部依赖（用于测试或自定义配置）
   */
  injectDeps(deps: {
    sequencer?: L1Sequencer;
    extractor?: L2ContentExtractor;
    annotator?: L3EntityAnnotator;
    detector?: SemanticBoundaryDetector;
    taxonomy?: TaxonomyTree;
  }): void {
    if (deps.sequencer) this.sequencer = deps.sequencer;
    if (deps.extractor) this.extractor = deps.extractor;
    if (deps.annotator) this.annotator = deps.annotator;
    if (deps.detector) this.detector = deps.detector;
    if (deps.taxonomy) this.taxonomy = deps.taxonomy;
  }

  /**
   * 推入一条用户话语，流式模式。
   *
   * - 当前缓冲为空时：直接缓冲，返回 null
   * - 检测到语义边界时：自动 flush 上一个语义单位，返回对应的 DNA
   * - 未检测到边界时：加入当前缓冲，返回 null
   *
   * 注意：用 push() 推入的所有话语最终需要调用 flush() 获取最后一段的 DNA。
   *
   * @param input 推入的话语（字符串快捷方式或 PushInput 对象）
   * @returns 如果触发了自动 flush 则返回上一个语义单位的 DNA，否则 null
   */
  push(input: string | PushInput): DNA | null {
    const normalized: PushInput = typeof input === 'string' ? { utterance: input } : input;
    const contextStr = (normalized.context ?? []).join(' ');
    const entry: BufferEntry = {
      utterance: normalized.utterance,
      context: contextStr,
      timestamp: normalized.timestamp,
    };

    // 缓冲非空时检测边界
    if (this.buffer.length > 0) {
      const last = this.buffer[this.buffer.length - 1];
      const boundary = this.detector.detect(
        last.utterance,
        normalized.utterance,
        {
          prevTimestamp: last.timestamp,
          currTimestamp: normalized.timestamp,
        }
      );

      if (boundary.is_new_unit) {
        // 自动 flush 上一个单位，然后缓冲当前话语
        const dna = this.flush();
        this.buffer.push(entry);
        return dna;
      }
    }

    // 无边界 → 加入缓冲
    this.buffer.push(entry);
    return null;
  }

  /**
   * 强制 flush 当前缓冲区的所有话语，合并为一条 DNA。
   *
   * 叶子节点中存储的是合并后的完整文本，
   * 确保每个叶子节点承载一个"最小语义单位"。
   *
   * @returns 合并后的 DNA，若缓冲区为空则返回 null
   */
  flush(): DNA | null {
    if (this.buffer.length === 0) return null;

    // 合并缓冲区内所有话语
    const combinedText = this.buffer.map((b) => b.utterance).join(' ');
    const combinedContext = this.buffer
      .map((b) => b.context)
      .filter(Boolean)
      .join(' ');

    const dna = this._encodeCombined(combinedText, combinedContext);

    // 清空缓冲
    this.buffer = [];

    return dna;
  }

  /**
   * 直接编码单条话语（非流式模式）。
   * 每次调用产生一条独立的 DNA，不经过缓冲区。
   * 适用于调用方已经做好语义切割的场景。
   */
  encodeSingle(utterance: string, context?: string[]): DNA {
    this.stats.encodeCount++;
    // P1: 输入守卫 — 空/非字符串输入返回空DNA，不崩溃
    if (!utterance || typeof utterance !== 'string' || utterance.trim().length === 0) {
      this.stats.failCount++;
      console.warn('[M1] 空输入编码, 返回空DNA');
      return this._makeEmptyDNA();
    }
    const contextStr = (context ?? []).join(' ');
    return this._encodeCombined(utterance, contextStr);
  }

  /**
   * 批量编码多条输入（每条独立编码为一条 DNA）。
   */
  encodeBatch(inputs: Array<{ utterance: string; context?: string[] }>): DNA[] {
    return inputs.map((input) => this.encodeSingle(input.utterance, input.context));
  }

  /**
   * 重置会话状态（开始新会话时调用）
   * 会清空缓冲区和序列计数器
   */
  resetSession(): void {
    this.buffer = [];
    this.sequencer.reset();
    this.extractor.reset();
  }

  /**
   * 获取当前缓冲区中的话语数（仅用于测试/调试）
   */
  /** 获取编码运行时统计 */
  getStats(): { encodeCount: number; failCount: number; failRate: number; stageFailures: Record<string, number> } {
    return { ...this.stats, failRate: this.stats.encodeCount > 0 ? Math.round(this.stats.failCount / this.stats.encodeCount * 100) / 100 : 0 };
  }

  /** 生成空 DNA（输入守卫兜底） */
  private _makeEmptyDNA(): DNA {
    const l1Result = this.sequencer.next();
    return {
      locus_path: 'user.misc.default',
      taxonomy_version: '1.0',
      branch_id: l1Result.branch_id,
      seq_pos: l1Result.seq_pos,
      leaf_zone: 'language_semantic_zone',
      ref: 'tmp_empty',
      entity_genes: [],
      raw_input: '',
      created_at: new Date().toISOString(),
      scene_tags: [],
      dna_root_id: DNAEncoder.generateRootId(),
      warnings: ['empty_input'],
    };
  }

  /** 慢编码告警 */
  private _warnSlow(stage: string, ms: number): void {
    if (ms > 50) console.warn('[M1] SLOW [' + stage + ']: ' + ms.toFixed(0) + 'ms');
  }

  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * 由 locus_path + entity_genes 派生场景语义标签。
   * 纯规则，无 LLM。与 taxonomy 版本耦合。
   */
  private deriveSceneTags(locusPath: string, entityGenes: Array<{ type: string; name: string }>): string[] {
    const tags: string[] = [];

    // ── 从 locus_path 推导大类标签 ──
    const locusMap: Record<string, string[]> = {
      'user.family.conflict': ['家庭矛盾'],
      'user.family.care': ['家庭', '关心'],
      'user.family.general': ['家庭'],
      'user.emotion.negative': ['负面情绪'],
      'user.emotion.positive': ['正面情绪'],
      'user.emotion.neutral': ['情绪'],
      'user.emotion.suppressed': ['压抑', '倾诉'],
      'user.emotion.romantic': ['亲密', '浪漫'],
      'user.emotion.miss_family': ['思念'],
      'user.work.stress': ['工作', '压力'],
      'user.work.achievement': ['工作', '成就'],
      'user.work.project': ['工作', '开发'],
      'user.work.meeting': ['会议'],
      'user.work.burnout': ['倦怠', '疲惫'],
      'user.work.general': ['工作'],
      'user.daily.creation': ['创作', '艺术'],
      'user.daily.entertainment': ['娱乐'],
      'user.daily.general': ['日常'],
      'user.health.fitness': ['健身', '运动'],
      'user.health.sickness': ['生病', '健康'],
      'user.health.sleep': ['睡眠'],
    };

    const matched = locusMap[locusPath];
    if (matched) tags.push(...matched);

    // ── 从 entity_genes 补充标签 ──
    const emotionTagMap: Record<string, string> = {
      '开心': '快乐', '难过': '悲伤', '生气': '愤怒', '害怕': '恐惧',
      '焦虑': '焦虑', '累': '疲惫', '爱': '爱意',
    };
    for (const g of entityGenes) {
      if (g.type === 'emotion' && emotionTagMap[g.name]) {
        if (!tags.includes(emotionTagMap[g.name])) tags.push(emotionTagMap[g.name]);
      }
      if (g.type === 'person' && !tags.includes('人际')) tags.push('人际');
      if (g.type === 'event' && !tags.includes('事件')) tags.push('事件');
    }

    return tags;
  }

  /**
   * 核心编码流水线：L0 → L1 → L2 → L3
   */
  private _encodeCombined(utterance: string, context: string): DNA {
    const warnings: string[] = [];
    const timings: Record<string, number> = {};

    // ── L0: 基因组锚点 (with stage-level isolation) ──
    let l0Result: L0RouteResult;
    const t0 = performance.now();
    try {
      const taxonomy = this.taxonomy ?? loadTaxonomy();
      l0Result = routeL0(utterance, taxonomy);
    } catch (err) {
      console.warn('[M1] L0 失败:', (err as Error).message);
      this.stats.stageFailures.l0++;
      this.stats.failCount++;
      return this._makeEmptyDNA();
    }
    timings.l0 = performance.now() - t0;
    this._warnSlow('L0', timings.l0);

    // ── L1: 分支路由码 ──
    let l1Result: L1SequenceResult;
    const t1 = performance.now();
    try {
      l1Result = this.sequencer.next();
    } catch (err) {
      console.warn('[M1] L1 失败:', (err as Error).message);
      this.stats.stageFailures.l1++;
      this.stats.failCount++;
      warnings.push('L1_failed');
      l1Result = { branch_id: 'evt_fallback_' + Date.now().toString(36), seq_pos: 0 };
    }
    timings.l1 = performance.now() - t1;
    this._warnSlow('L1', timings.l1);

    // ── L2: 叶节点指针 ──
    let l2Result: L2ContentResult;
    const t2 = performance.now();
    try {
      l2Result = this.extractor.extract(l0Result!.locus_path, utterance);
    } catch (err) {
      console.warn('[M1] L2 失败:', (err as Error).message);
      this.stats.stageFailures.l2++;
      warnings.push('L2_failed');
      l2Result = { leaf_zone: 'language_semantic_zone', ref: 'tmp_fallback' };
    }
    timings.l2 = performance.now() - t2;
    this._warnSlow('L2', timings.l2);

    // ── L3: 实体基因槽 ──
    let l3Result: L3AnnotationResult;
    const t3 = performance.now();
    try {
      l3Result = this.annotator.annotate(utterance, context, this.selfModel);
    } catch (err) {
      console.warn('[M1] L3 失败:', (err as Error).message);
      this.stats.stageFailures.l3++;
      warnings.push('L3_failed');
      l3Result = { entity_genes: [] };
    }
    timings.l3 = performance.now() - t3;
    this._warnSlow('L3', timings.l3);

    // ── 从 L0 结果 + L3 基因派生语义标签 ──
    const sceneTags = this.deriveSceneTags(l0Result!.locus_path, l3Result!.entity_genes);

    // ── SP2-1: 生成物料根码（一个对话一个根码） ──
    const dna_root_id = DNAEncoder.generateRootId();

    // ── 组装 DNA ──
    const dna: DNA = {
      locus_path: l0Result.locus_path,
      taxonomy_version: l0Result.taxonomy_version,
      branch_id: l1Result.branch_id,
      seq_pos: l1Result.seq_pos,
      leaf_zone: l2Result.leaf_zone,
      ref: l2Result.ref,
      entity_genes: l3Result.entity_genes,
      raw_input: utterance,
      created_at: new Date().toISOString(),
      scene_tags: sceneTags,
      ambiguity_score: l0Result!.ambiguity_score,
      warnings: warnings.length > 0 ? warnings : undefined,
      dna_root_id,
    };

    return dna;
  }
}
