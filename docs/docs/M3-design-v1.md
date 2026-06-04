# M3 逻辑决策与感知层 · 设计文档

> **文档状态**: Pre-Design Draft（待评审）  
> **关联规格书**: `docs/project-spec-v1.md` §1.6（本体-标签分离）, §3（M1接口）  
> **关联 ADR**: ADR-004 (M1-M2边界), ADR-006 (本体-标签分离)  
> **版本**: v0.1-design  
> **前置模块**: M1 DNAEncoder (已完成), M2 JsonStorageAdapter (已完成, 已签字)  
> **输出目标**: 本文件评审通过后，方可进入 M3 编码阶段

---

## 第1章 职责边界

### 1.1 M3 做什么

| 职责 | 说明 |
| :--- | :--- |
| **感知分析** | 接收 M1 的 DNA，计算 24 维语义感知向量 + 钙质强度 |
| **逻辑决策** | 根据感知结果决定下一步动作（忽略/记忆/追问/安慰/行动） |
| **上下文整合** | 结合 M2 历史数据、当前时间（2026-06-02）、地点（深圳）做决策 |
| **输出动作流** | 返回有序的动作列表供下游 M5 执行 |

### 1.2 M3 不做什么

- ❌ **不生成自然语言**（那是 M5 的职责）
- ❌ **不存储数据**（M2 负责存储）
- ❌ **不修改 DNA**（感知结果是独立元数据，不污染 DNA 本体）
- ❌ **不调用 LLM**（24维计算是纯规则驱动）

### 1.3 架构流水线定位

```
M1 (编码) → M2 (存储) → M3 (感知+决策) → M4 (知识融合) → M5 (表达)
                          ↑
                    感知分析器
                    24维 + 钙质
```

---

## 第2章 M3 核心接口定义

### 2.1 24 维语义感知向量 （SemanticVector24）

已在 `src/m3/types/perception.ts` 中正确定义。此处重申架构契约：

| 象限 | 维度 | 范围 | 规则来源示例 |
| :--- | :--- | :--- | :--- |
| **E 情绪** | pleasure, arousal, dominance, aggression, sincerity, humor | -1~1 / 0~1 | 正负面词表、唤醒词、支配词、攻击词 |
| **C 认知** | factual, logical, certainty, abstract, temporal_focus, self_ref | -1~1 / 0~1 | 数字检测、逻辑连接词、不确定词 |
| **S 社会** | intimacy, power_diff, dependency, moral_judgment, etiquette, belonging | -1~1 / 0~1 | 亲密词、权力词、礼仪词、群体词 |
| **I 亲密** | sexual_attraction, sensory_craving, energy_merge, possessiveness, ecstasy, safety | 0~1 | 性吸引词、感官词、占有词 |

### 2.2 钙质强度

| 等级 | 范围 | 标签 | M3 动作 |
| :--- | :--- | :--- | :--- |
| 0 | 0.0 ~ 0.3 | 粉末 | `ignore` |
| 1 | 0.3 ~ 0.6 | 液体 | `memorize` |
| 2 | 0.6 ~ 0.8 | 固体 | `ask` / `comfort` |
| 3 | 0.8 ~ 1.0 | 晶体 | `act` |

### 2.3 M3 决策动作（M3Action）

```typescript
/**
 * M3 决策动作类型
 *
 * ignore    — 忽略（粉末级，噪音废话）
 * memorize  — 记忆（液体级，正常交流，只需记录）
 * ask       — 追问（固体级，话题值得深入，主动询问细节）
 * comfort   — 安慰（固体级，检测到负面情绪，需要情感支持）
 * act       — 行动（晶体级，重大事件或极致情感，触发核心响应）
 */
export type M3Action = 'ignore' | 'memorize' | 'ask' | 'comfort' | 'act';
```

### 2.4 决策上下文

```typescript
export interface M3Context {
  /** 当前时间（默认从系统获取） */
  current_time: string;       // ISO8601
  /** 当前地点（从 L3 实体提取或外部传入） */
  current_location?: string;
  /** 最近的 M3 决策历史（用于连续性判断） */
  recent_decisions?: M3Decision[];
  /** 用户情感基线（用于异常检测） */
  emotion_baseline?: {
    avg_pleasure: number;
    avg_arousal: number;
  };
}
```

### 2.5 M3 决策结果

```typescript
export interface M3Decision {
  /** 增强型 DNA（含 24维感知 + 钙质） */
  enhanced: EnhancedDNA;
  /** 决策动作列表（可多个，按优先级排序） */
  actions: M3Action[];
  /** 决策理由 */
  reason: string;
  /** 当前时间上下文 */
  timestamp: string;
}
```

---

## 第3章 主控制器：M3LogicOrchestrator

### 3.1 输入输出契约

```
输入: DNA + M3Context
         ↓
流程: 感知分析 → 钙质计算 → 决策路由 → 上下文增强 → 动作列表
         ↓
输出: M3Decision { enhanced, actions[], reason }
```

### 3.2 决策路由表

决策依据两个主维度：**钙质等级** + **情绪极性**。

| 钙质等级 | 愉悦度 > 0.2 | 愉悦度 < -0.2 | 愉悦度中性 |
| :--- | :--- | :--- | :--- |
| **粉末** | ignore | ignore | ignore |
| **液体** | memorize | memorize | memorize |
| **固体** | ask（追问细节） | comfort（情感支持） | memorize + ask |
| **晶体** | act（分享喜悦） | act（紧急安抚） | act（触发核心机制） |

### 3.3 特殊规则（Shenzhen 2026-06-02 上下文）

**时效性规则**:
- 检测 `raw_input` 中的时间词："今天"、"刚才"、"现在" → 与 `context.current_time` 比对
- 如果时间词匹配当日（2026-06-02），提升 C5_temporal_focus 的绝对值
- 如果提及"昨天/以前"等过去词，且对应事件在 M2 中无记录，标记为 `ask`（追问）

**地点感知规则**:
- 检测 `entity_genes` 中的 `type: 'place'` 实体
- 如果地点为 "深圳" 或 `context.current_location` 匹配，提升 S6_belonging 分数
- 如果地点为陌生地名且未在历史中出现，降低 S1_intimacy 分数

### 3.4 决策链

```typescript
decide(dna: DNA, context?: M3Context): M3Decision {
  // Phase 1: 24维感知
  const enhanced = this.analyzer.analyze(dna);
  
  // Phase 2: 上下文注入（时间 + 地点）
  this.injectContext(enhanced, context);
  
  // Phase 3: 钙质重算（上下文可能改变部分维度）
  const calcium = recalculateCalcium(enhanced.perception);
  enhanced.calcium_score = calcium.score;
  enhanced.calcium_level = calcium.level;
  
  // Phase 4: 决策路由
  const actions = this.route(calcium.level, enhanced.perception.pleasure);
  
  // Phase 5: 生成理由
  const reason = this.describe(actions, enhanced);
  
  return { enhanced, actions, reason, timestamp: now };
}
```

---

## 第4章 感知分析器：PerceptionAnalyzer

### 4.1 状态说明

PerceptionAnalyzer **已在架构纠偏时迁移到 M3**，位于 `src/m3/PerceptionAnalyzer.ts`。当前状态：

| 项 | 状态 |
| :--- | :--- |
| 24 维评分逻辑 | ✅ 已实现（纯规则，词表驱动） |
| 钙质公式 | ✅ 已实现（Base_Core + Emotional_Boost + Threat_Bonus） |
| analyze(dna): EnhancedDNA | ✅ 已实现 |
| analyzeText(text) | ✅ 已实现（调试用） |
| 26 个测试 | ✅ 已迁移 |

**本次设计需要新增的能力**:
- `injectContext(enhanced, context)` — 上下文注入（时间 + 地点影响 S6 / C5）
- `recalculateCalcium(perception)` — 上下文修正后的钙质重算

### 4.2 上下文注入规则

```typescript
injectContext(enhanced: EnhancedDNA, context?: M3Context): void {
  if (!context) return;
  
  // 时效性规则
  if (enhanced.raw_input.includes('今天') || enhanced.raw_input.includes('现在')) {
    // 提升 temporal_focus 指向当前
    enhanced.perception.temporal_focus = Math.max(enhanced.perception.temporal_focus, 0.2);
  }
  if (enhanced.raw_input.includes('刚才')) {
    // 提升唤醒度（刚发生的事情绪更鲜活）
    enhanced.perception.arousal = Math.min(enhanced.perception.arousal + 0.1, 1.0);
  }
  
  // 地点感知规则
  const hasLocalPlace = enhanced.entity_genes.some(
    e => e.type === 'place' && e.name === context.current_location
  );
  if (hasLocalPlace) {
    enhanced.perception.belonging = Math.min(enhanced.perception.belonging + 0.15, 1.0);
    enhanced.perception.intimacy = Math.min(enhanced.perception.intimacy + 0.1, 1.0);
  }
}
```

---

## 第5章 测试策略

### 5.1 测试覆盖

| 测试类别 | 用例 | 数量 |
| :--- | :--- | :--- |
| **24维完整性** | 所有 24 个维度和钙质字段均存在 | 1 |
| **情绪极性** | 正/负/中性文本产生正确的 pleasure 正负 | 3 |
| **社会交互** | 亲密词/礼仪词/群体词评分 | 3 |
| **亲密象限** | 性吸引/感官/占有评分 | 2 |
| **钙质公式** | 粉末/液体/固体/晶体四级验证 | 4 |
| **决策路由** | 各种钙质+情绪组合的正确动作 | 6 |
| **上下文注入** | 时间词修改 temporal_focus、地点词修改 belonging | 2 |
| **边界情况** | 空输入/超长/特殊字符/确定性 | 4 |

### 5.2 Hook 要点

| Hook 类型 | 断言 |
| :--- | :--- |
| **输入契约** | 接收 DNA + context，输出 M3Decision |
| **铁律-确定性** | 相同输入 50 次返回完全相同结果 |
| **铁律-无LLM** | PerceptionAnalyzer 不导入任何 API/LLM 模块 |
| **降级-空context** | context 为空时不崩溃，使用默认值 |

---

## 第6章 交付清单

### 已有文件（已确认位置正确）

| 文件 | 状态 |
| :--- | :--- |
| `src/m3/types/perception.ts` | ✅ 已存在（从 M1 迁移，含 Perception24D / CalciumResult / EnhancedDNA） |
| `src/m3/PerceptionAnalyzer.ts` | ✅ 已存在（从 M1 迁移，纯规则 24 维评分 + 钙质公式） |
| `src/m3/__tests__/PerceptionAnalyzer.test.ts` | ✅ 已存在（26 个测试） |

### 本次需新增/修改的文件

| 文件 | 变更 | 说明 |
| :--- | :--- | :--- |
| `src/m3/types/perception.ts` | 🔄 新增 M3Action / M3Context / M3Decision | 决策动作类型 + 上下文接口 |
| `src/m3/PerceptionAnalyzer.ts` | 🔄 新增 injectContext() | 时间/地点上下文注入能力 |
| `src/m3/M3LogicOrchestrator.ts` | ✅ 新建 | 主控制器（感知→决策→输出） |
| `src/m3/__tests__/M3LogicOrchestrator.test.ts` | ✅ 新建 | 决策路由 + 上下文测试 |
| `docs/project-spec-v1.md` | 🔄 更新 §5 | 新增 M3 章节占位 |

---

**M3 设计文档结束 — 请评审**

*注：本文件仅描述设计，不含任何新的业务代码实现。评审通过后将进入编码阶段。现有 M3 文件（perception.ts, PerceptionAnalyzer.ts）已在架构纠偏时迁移到位，不在此次编码范围内。*
