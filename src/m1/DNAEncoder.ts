// Ref: ARCH.md §3.2 写入正向流: L0 → L1 → L2 → L3 逐层生成
// Ref: ARCH.md §3.2 无DNA不写入 — 未经编码器的碎片禁止进入存储区
// Ref: 架构决策备忘录 v1.3 — 叶子节点存储粒度为"最小语义单位"

import { routeL0, loadTaxonomy } from './L0Router.js';
import { L1Sequencer } from './L1Sequencer.js';
import { L2ContentExtractor } from './L2ContentExtractor.js';
import { L3EntityAnnotator } from './L3EntityAnnotator.js';
import { SemanticBoundaryDetector } from './SemanticBoundaryDetector.js';
import type {
  DNA,
  TaxonomyTree,
  SelfModelV1,
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
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * 核心编码流水线：L0 → L1 → L2 → L3
   */
  private _encodeCombined(utterance: string, context: string): DNA {
    // ── L0: 基因组锚点 ──
    // Ref: ARCH.md §3.1 L0
    const taxonomy = this.taxonomy ?? loadTaxonomy();
    const l0Result = routeL0(utterance, taxonomy);

    // ── L1: 分支路由码 ──
    // Ref: ARCH.md §3.1 L1
    const l1Result = this.sequencer.next();

    // ── L2: 叶节点指针 ──
    // Ref: ARCH.md §3.1 L2
    const l2Result = this.extractor.extract(l0Result.locus_path, utterance);

    // ── L3: 实体基因槽 ──
    // Ref: ARCH.md §3.1 L3
    // 实体提取在合并后的完整文本上进行，确保上下文不丢失
    const l3Result = this.annotator.annotate(
      utterance,
      context,
      this.selfModel
    );

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
    };

    return dna;
  }
}
