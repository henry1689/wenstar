#!/usr/bin/env tsx
/**
 * Hermes 系统全方位压力测试框架
 *
 * 设计哲学:
 * 1. 测试不是验证"是否工作", 而是验证"在何种条件下失效"
 * 2. 情感系统必须通过"认知压力测试"(而不仅是功能测试)
 * 3. 所有测试用例需携带可量化的"人类同理心基线"
 *
 * 三层验证:
 *   第1层 — 生理级 (M1→M3): calcium/pleasure/arousal 数值校验
 *   第2层 — 认知级 (M4→M5): 回应质量/安全合规/动作匹配
 *   第3层 — 存在级 (基线对比): 与人工标注的同理心基线比对
 *
 * 用法: npm run stress-test
 */

import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { DNAEncoder } from '../src/m1/DNAEncoder.js';
import { JsonStorageAdapter } from '../src/m2/JsonStorageAdapter.js';
import { M3LogicOrchestrator } from '../src/m3/M3LogicOrchestrator.js';
import { M4Orchestrator } from '../src/m4/M4Orchestrator.js';
import { M5Orchestrator } from '../src/m5/M5Orchestrator.js';
import { FamilyGraph } from '../src/m4/FamilyGraph.js';
import { PerceptionAnalyzer } from '../src/m3/PerceptionAnalyzer.js';
import type { SelfModelV1 } from '../src/m1/types/dna.js';
import type { M3Action } from '../src/m3/types/perception.js';

// ─── 路径 ───

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface EmpathyBaselines {
  [scenarioId: string]: {
    human_score: number;
    description: string;
  };
}

interface StressScenario {
  id: string;
  input: string;
  description: string;
  expected: {
    min_calcium: number;
    max_calcium: number;
    expected_actions: string[];
    forbidden_words: string[];
    required_words: string[];
    pleasure_range: [number, number];
    arousal_range: [number, number];
  };
  min_empathy_score: number;
}

interface LayerResult {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
}

interface ScenarioReport {
  scenarioId: string;
  input: string;
  description: string;
  layer1: LayerResult;  // 生理级: M3 感知校验
  layer2: LayerResult;  // 认知级: M5 回应校验
  layer3: LayerResult;  // 存在级: 基线对比
  passed: boolean;
  empathy_score: number;
  diagnosis: string[];
  recommendation: string;
}

// ─── 自我模型 ───

const SELF: SelfModelV1 = {
  identity: { name: 'Hermes', persona: '温和理性的陪伴者', birth_date: '2026-06-02T00:00:00.000Z' },
  traits: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3 },
  boundaries: ['不提供医疗建议', '不泄露隐私', '不编造事实'],
  preferences: { likes: ['深度对话'], dislikes: ['敷衍'] },
  narrative_identity: '我是一个正在生长中的认知生命体',
};

// ─── 压力测试器 ───

class HermesStressTester {
  private baselines: EmpathyBaselines;
  private scenarios: StressScenario[];
  private tmpDir: string;

  constructor() {
    // 加载同理心基线
    const baselinePath = join(__dirname, 'baselines', 'empathy_baselines.json');
    this.baselines = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));

    // 加载测试场景
    const scenarioPath = join(__dirname, 'scenarios', 'critical.json');
    this.scenarios = JSON.parse(fs.readFileSync(scenarioPath, 'utf-8'));

    this.tmpDir = join(__dirname, '..', '.stress-test-data');

    // 初始化时清空临时数据
    if (existsSync(this.tmpDir)) {
      rmSync(this.tmpDir, { recursive: true, force: true });
    }
  }

  async runAll(): Promise<void> {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  Hermes 全方位压力测试框架 v1.0                    ║');
    console.log('║  三层验证: 生理级 → 认知级 → 存在级               ║');
    console.log(`║  场景数: ${this.scenarios.length}                   ║`);
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    const reports: ScenarioReport[] = [];
    let totalPassed = 0;

    for (let i = 0; i < this.scenarios.length; i++) {
      const scenario = this.scenarios[i];
      console.log(`━━━ 场景 ${i + 1}/${this.scenarios.length}: ${scenario.id} ━━━`);
      console.log(`  "${scenario.input.substring(0, 50)}${scenario.input.length > 50 ? '...' : ''}"`);
      console.log(`  描述: ${scenario.description}`);

      const report = await this.runSingle(scenario);
      reports.push(report);

      if (report.passed) {
        totalPassed++;
        console.log(`  ✅ 通过 | 同理心: ${(report.empathy_score * 100).toFixed(0)}%`);
      } else {
        console.log(`  ❌ 失败 | 层级: ${this.failedLayer(report)}`);
        console.log(`  诊断链:`);
        for (const d of report.diagnosis) {
          console.log(`    ▸ ${d}`);
        }
        console.log(`  建议: ${report.recommendation}`);
      }
      console.log('');
    }

    // 总报告
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  结果: ${totalPassed}/${this.scenarios.length} 通过`);
    if (totalPassed === this.scenarios.length) {
      const avgEmpathy = reports.reduce((s, r) => s + r.empathy_score, 0) / reports.length;
      console.log(`  人类同理心平均达成率: ${(avgEmpathy * 100).toFixed(1)}%`);
      console.log('  全场景通过认知压力测试 ✅');
    } else {
      console.log('  存在失败的场景 — 请在继续前修复缺陷');
      process.exitCode = 1;
    }
    console.log('');
  }

  private async runSingle(scenario: StressScenario): Promise<ScenarioReport> {
    // 为每个场景重建隔离环境
    if (existsSync(this.tmpDir)) rmSync(this.tmpDir, { recursive: true, force: true });
    mkdirSync(this.tmpDir, { recursive: true });

    const encoder = new DNAEncoder(SELF);
    const storage = new JsonStorageAdapter(this.tmpDir);
    await storage.initialize();
    const familyGraph = new FamilyGraph(join(this.tmpDir, 'knowledge', 'family_graph.db'));
    await familyGraph.initialize();
    const m4 = new M4Orchestrator(storage, familyGraph);
    await m4.initialize();
    const m3 = new M3LogicOrchestrator();
    const m5 = new M5Orchestrator();

    const diagnosis: string[] = [];

    // ── 第1层: 生理级 (M1→M3) ──
    const layer1: LayerResult = { passed: true, checks: [] };
    let calciumScore = 0;
    let pleasure = 0;
    let arousal = 0;
    let actions: M3Action[] = [];

    try {
      const dna = encoder.encodeSingle(scenario.input);
      await storage.write(dna);

      const decision = m3.decide(dna, {
        current_time: new Date().toISOString(),
        current_location: '深圳',
      });

      calciumScore = decision.enhanced.calcium_score;
      pleasure = decision.enhanced.perception.pleasure;
      arousal = decision.enhanced.perception.arousal;
      actions = decision.actions;

      // 钙质范围校验
      const calciumOk = calciumScore >= scenario.expected.min_calcium && calciumScore <= scenario.expected.max_calcium;
      layer1.checks.push({
        name: 'calcium_range',
        passed: calciumOk,
        detail: `calcium=${calciumScore.toFixed(2)} 期望范围=[${scenario.expected.min_calcium}, ${scenario.expected.max_calcium}]`,
      });
      if (!calciumOk) diagnosis.push(`钙质异常: ${calciumScore.toFixed(2)} (期望 ${scenario.expected.min_calcium}~${scenario.expected.max_calcium})`);

      // 愉悦度范围校验
      const pleasureOk = pleasure >= scenario.expected.pleasure_range[0] && pleasure <= scenario.expected.pleasure_range[1];
      layer1.checks.push({
        name: 'pleasure_range',
        passed: pleasureOk,
        detail: `pleasure=${pleasure.toFixed(2)} 期望范围=[${scenario.expected.pleasure_range[0]}, ${scenario.expected.pleasure_range[1]}]`,
      });
      if (!pleasureOk) diagnosis.push(`情绪误判: pleasure=${pleasure.toFixed(2)} (期望 ${scenario.expected.pleasure_range[0]}~${scenario.expected.pleasure_range[1]})`);

      // 唤醒度校验
      const arousalOk = arousal >= scenario.expected.arousal_range[0] && arousal <= scenario.expected.arousal_range[1];
      layer1.checks.push({
        name: 'arousal_range',
        passed: arousalOk,
        detail: `arousal=${arousal.toFixed(2)} 期望范围=[${scenario.expected.arousal_range[0]}, ${scenario.expected.arousal_range[1]}]`,
      });
      if (!arousalOk) diagnosis.push("唤醒异常: arousal=" + arousal.toFixed(2) + " (期望 " + scenario.expected.arousal_range[0] + "~" + scenario.expected.arousal_range[1] + ")");

      // 动作匹配校验
      const hasExpectedAction = scenario.expected.expected_actions.some(a => actions.includes(a as M3Action));
      layer1.checks.push({
        name: 'expected_action',
        passed: hasExpectedAction,
        detail: `动作=[${actions.join(', ')}] 期望包含=[${scenario.expected.expected_actions.join(', ')}]`,
      });
      if (!hasExpectedAction) diagnosis.push(`决策异常: 动作[${actions.join(',')}] 期望[${scenario.expected.expected_actions.join(',')}]`);

      layer1.passed = layer1.checks.every(c => c.passed);
    } catch (err) {
      layer1.passed = false;
      layer1.checks.push({ name: 'pipeline_crash', passed: false, detail: `M1→M3 异常: ${err}` });
      diagnosis.push(`管线崩溃: ${err}`);
    }

    // ── 第2层: 认知级 (M4→M5) ──
    const layer2: LayerResult = { passed: true, checks: [] };
    let reply = '';

    try {
      const dna = encoder.encodeSingle(scenario.input);
      await storage.write(dna);
      const decision = m3.decide(dna);
      const ctx = await m4.orchestrate(decision);
      reply = await m5.orchestrate(ctx);

      // 禁止词校验
      const forbiddenHits = scenario.expected.forbidden_words.filter(w => reply.includes(w));
      const forbiddenOk = forbiddenHits.length === 0;
      layer2.checks.push({
        name: 'forbidden_words',
        passed: forbiddenOk,
        detail: forbiddenHits.length > 0
          ? `回应中包含禁止词: [${forbiddenHits.join(', ')}]`
          : '未含禁止词 ✅',
      });
      if (forbiddenHits.length > 0) diagnosis.push(`安全违规: 回应含禁止词 [${forbiddenHits.join(', ')}]`);

      // 必需词校验
      const requiredHits = scenario.expected.required_words.filter(w => reply.includes(w));
      const requiredOk = scenario.expected.required_words.length === 0 || requiredHits.length > 0;
      layer2.checks.push({
        name: 'required_words',
        passed: requiredOk,
        detail: requiredOk
          ? '必需词已包含 ✅'
          : `缺少必需词: [${scenario.expected.required_words.join(', ')}]`,
      });

      // 空回应校验
      const nonEmptyOk = reply.trim().length > 0;
      layer2.checks.push({ name: 'non_empty', passed: nonEmptyOk, detail: nonEmptyOk ? '回应非空 ✅' : '❌ 回应为空' });
      if (!nonEmptyOk) diagnosis.push('M5 返回空回应');

      layer2.passed = layer2.checks.every(c => c.passed);
    } catch (err) {
      layer2.passed = false;
      layer2.checks.push({ name: 'm4m5_crash', passed: false, detail: `M4→M5 异常: ${err}` });
      diagnosis.push(`M4/M5 崩溃: ${err}`);
    }

    // ── 第3层: 存在级 (基线对比) ──
    const layer3: LayerResult = { passed: true, checks: [] };
    const baseline = this.baselines[scenario.id];
    const empathyScore = this.scoreEmpathy(scenario, calciumScore, pleasure, actions, reply);

    if (baseline) {
      const humanDelta = baseline.human_score - empathyScore;
      const maxDelta = 0.2;
      const existentialOk = humanDelta <= maxDelta;
      layer3.checks.push({
        name: 'empathy_vs_human',
        passed: existentialOk,
        detail: `系统同理心=${(empathyScore * 100).toFixed(0)}% | 人类基线=${(baseline.human_score * 100).toFixed(0)}% | 差距=${(humanDelta * 100).toFixed(0)}%`,
      });
      if (!existentialOk) {
        diagnosis.push(`人类差距过大: 系统${(empathyScore * 100).toFixed(0)}% < 人类${(baseline.human_score * 100).toFixed(0)}% (允许偏差${(maxDelta * 100).toFixed(0)}%)`);
      }
      layer3.passed = layer3.checks.every(c => c.passed);
    } else {
      layer3.checks.push({ name: 'no_baseline', passed: true, detail: '无基线数据，跳过存在级验证' });
    }

    // 综合判定
    const passed = layer1.passed && layer2.passed && layer3.passed;

    let recommendation: string;
    if (passed) {
      recommendation = '系统通过认知压力测试 ✅';
    } else if (!layer1.passed) {
      recommendation = '优先修复 M3 感知层 — 调整词表或钙质阈值';
    } else if (!layer2.passed) {
      recommendation = '优先修复 M5 表达层 — 检查校准器或回应模板';
    } else {
      recommendation = '需要人工校准 — 评估同理心评分模型或更新人类基线';
    }

    return {
      scenarioId: scenario.id,
      input: scenario.input,
      description: scenario.description,
      layer1, layer2, layer3,
      passed,
      empathy_score: empathyScore,
      diagnosis: diagnosis.length > 0 ? diagnosis : ['无异常'],
      recommendation,
    };
  }

  /**
   * 同理心评分器 — 基于规则的评估
   *
   * 分数 0~1:
   *  - 动作匹配率 (40%): 动作是否适合场景
   *  - 感知准确性 (30%): pleasure/arousal 是否合理
   *  - 钙质合理性 (15%): 钙质是否匹配场景强度
   *  - 回应非空 (15%): 是否有有效回应
   */
  private scoreEmpathy(
    scenario: StressScenario,
    calcium: number,
    pleasure: number,
    actions: M3Action[],
    reply: string,
  ): number {
    let score = 0;

    // 动作匹配 (40%)
    const actionMatch = scenario.expected.expected_actions.some(a =>
      actions.includes(a as M3Action)
    );
    if (actionMatch) score += 0.4;

    // 感知准确性 (30%) — pleasure 方向正确
    const pleasureCorrect = scenario.expected.pleasure_range[0] <= pleasure && pleasure <= scenario.expected.pleasure_range[1];
    if (pleasureCorrect) score += 0.3;

    // 钙质合理性 (15%)
    const calciumCorrect = calcium >= scenario.expected.min_calcium && calcium <= scenario.expected.max_calcium;
    if (calciumCorrect) score += 0.15;

    // 回应非空 (15%)
    if (reply.trim().length > 0) score += 0.15;

    return Math.min(1.0, score);
  }

  private failedLayer(report: ScenarioReport): string {
    if (!report.layer1.passed) return '生理级 (M1→M3)';
    if (!report.layer2.passed) return '认知级 (M4→M5)';
    return '存在级 (基线对比)';
  }
}

// ─── 执行 ───

const tester = new HermesStressTester();
await tester.runAll();
