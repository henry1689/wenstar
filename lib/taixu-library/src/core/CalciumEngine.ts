/**
 * CalciumEngine — 钙化分计算 + 三段晋升判定
 *
 * 与主程序 M3 钙化分公式 100% 一致。
 * 零外部依赖。
 */

export interface CalciumInput {
  emotionalIntensity: number;
  intimacyLevel: number;
  socialRelevance: number;
  factualDensity: number;
  unusualness: number;
}

export interface DecayableRecord {
  calcium: number;
  tags?: string[];
}

export class CalciumEngine {
  /** 初始钙化分: weighted sum → [0, 10] */
  calculate(input: CalciumInput): number {
    const score =
      input.emotionalIntensity * 0.30 +
      input.intimacyLevel * 0.25 +
      input.socialRelevance * 0.20 +
      input.factualDensity * 0.15 +
      input.unusualness * 0.10;
    return Math.round(Math.min(10, Math.max(0, score)) * 10) / 10;
  }

  /** 召回增长: 每次 +0.2, 上限 10 */
  applyRecallIncrement(current: number): number {
    return Math.round(Math.min(10, current + 0.2) * 10) / 10;
  }

  /** 每日衰减 */
  applyDailyDecay(record: DecayableRecord): number {
    const isWorkRelated = record.tags?.some(
      t => ['work', 'tech', 'study', 'project', 'meeting'].includes(t)
    );
    const rate = isWorkRelated ? 0.05 : 0.10;
    return Math.round(Math.max(0, record.calcium - rate) * 10) / 10;
  }

  /** Raw → Wiki 晋升条件 */
  canPromoteToWiki(calcium: number): boolean {
    return calcium >= 1.0;
  }

  /** Wiki → Schema 晋升条件 */
  canPromoteToSchema(calcium: number, recallCount: number): boolean {
    return calcium >= 4.5 || recallCount >= 5;
  }

  /** 默认文档钙化分（初始值） */
  defaultDocumentCalcium(): number {
    return 1.0;
  }
}
