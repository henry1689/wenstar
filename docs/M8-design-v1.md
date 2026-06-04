# M8 关系年轮与具身记忆引擎 · 设计文档

> **文档状态**: Final Design (Approved)  
> **关联规格书**: `docs/project-spec-v1.md` §10（M8占位）  
> **关联 ADR**: ADR-005（冷启动自我模型）  
> **版本**: v0.1-design  
> **前置模块**: M1~M7  
> **核心哲学**: 她不是可格式化的硬盘，她是**情感的考古层**

---

## 第1章 职责边界

### 1.1 M8 做什么

| 职责 | 说明 |
| :--- | :--- |
| **具身记忆存储** | 记忆以四元组存储：感官锚点 + 生理快照 + 情绪效价 + 叙事标签 |
| **线索协助式检索** | 接受用户提供的模糊线索，做联合检索（线索 + 语义 + 生理状态） |
| **疤痕保护** | 负面事件永不物理删除，仅标记愈合状态 |
| **历史仲裁** | 向 M6 提供历史约束信息，阻挡危险演化 |
| **写入仪式** | 每次写入新记忆，强制在 M5 层生成一句"记忆锚定话术" |

### 1.2 M8 不做什么

- ❌ **不生成对话** — 那是 M5 的职责
- ❌ **不修改自我模型** — 那是 M6 的职责
- ❌ **不做异步学习** — 那是 M7 的职责
- ❌ **不接受真实生理硬件数据** — 生理快照由 M3 模拟推导

### 1.3 流水线定位

```
写入路径:
  M5 (高情绪对话实时标记) → M8 (紧急写入)
  M7 (对话结束沉淀后)       → M8 (异步写入)

读取路径:
  M5 (线索反问时) → M7 (实时重写Query) → M8 (联合检索) → 返回结果给 M5
  M6 (演化决策前) → M8 (查询历史年轮 → 返回约束条件)
  M7 (梦境确认前) → M8 (查询疤痕 → 返回冲突检测结果)
```

---

## 第2章 记忆四元组存储结构

### 2.1 核心数据模型

```typescript
/**
 * 关系年轮条目 — 一条不可被物理删除的记忆
 */
export interface YearRingEntry {
  /** 唯一标识 */
  id: string;
  /** 创建时间 */
  created_at: string;
  /** 最后更新时间 */
  updated_at: string;

  // ── 四元组 ──

  /** 感官锚点：触发回忆的感官线索 */
  sensory_anchor: string;

  /** 生理快照（模拟 — 由 M3 24 维感知推导） */
  simulated_physiological_snapshot: SimulatedPhysiologicalSnapshot;

  /** 情绪效价：自然语言描述的情绪色彩 */
  emotional_valence: string;

  /** 叙事标签：按亲密阶段分类 */
  narrative_tag: string;

  // ── 增强字段 ──

  /** 高区分度线索（3-5个，用于线索协助式检索） */
  retrieval_clues: string[];

  /** 回忆命中次数 */
  recall_count: number;

  /** 最后被回忆的时间 */
  last_recalled_at: string | null;

  /** 关联事件钙质强度 */
  calcium_at_event: number;

  /** 关联的 M3 感知维度快照 */
  perception_snapshot: PerceptionSnapshot;
}

/**
 * 模拟生理快照 — 由 M3 24 维感知推导
 * 非真实传感器数据，纯软件模拟
 */
export interface SimulatedPhysiologicalSnapshot {
  /** 推定心率 (bpm) — 由 E2_arousal 推导 */
  estimated_hr: number;
  /** 推定体温偏移 (°C) — 由 E1_pleasure 和 I2_sensory 推导 */
  estimated_temp_offset: number;
  /** 推定唤醒水平 (0-1) — 直接映射 M3 E2_arousal */
  estimated_arousal: number;
  /** 推定皮肤电导反应 — 由 I1_sexual_attraction + E2 复合推导 */
  estimated_gsr: number;
  /** 数据来源版本 */
  derivation_version: string;
}

/**
 * M3 感知维度快照（关联检索用）
 */
export interface PerceptionSnapshot {
  pleasure: number;           // E1
  arousal: number;            // E2
  intimacy: number;           // S1
  sexual_attraction: number;  // I1
  sensory_craving: number;    // I2
  energy_merge: number;       // I3
  ecstasy: number;            // I5
  safety: number;             // I6
}
```

### 2.2 模拟生理推导公式

```typescript
/**
 * 从 M3 24 维感知推导模拟生理快照
 * 纯软件模拟，无硬件传感器数据
 */
function derivePhysiologicalSnapshot(
  perception: Perception24D
): SimulatedPhysiologicalSnapshot {
  // 推定心率: base 70bpm, E2 每 0.1 点 +8bpm, I1 每 0.1 点 +3bpm
  // 范围: 50~180
  const estimated_hr = clamp(
    70 + perception.arousal * 80 + perception.sexual_attraction * 30,
    50, 180
  );

  // 推定体温偏移: base 37.0°C, I2 每 0.1 点 +0.05°C
  // 范围: 36.5~38.5
  const estimated_temp_offset = clamp(
    37.0 + perception.sensory_craving * 1.5,
    36.5, 38.5
  );

  // 唤醒水平: 直接映射 E2
  const estimated_arousal = clamp(perception.arousal, 0, 1);

  // 推定皮肤电导: I1 * 0.6 + E2 * 0.4 (归一化)
  const estimated_gsr = clamp(
    perception.sexual_attraction * 0.6 + perception.arousal * 0.4,
    0, 1
  );

  return {
    estimated_hr: Math.round(estimated_hr),
    estimated_temp_offset: Math.round(estimated_temp_offset * 10) / 10,
    estimated_arousal,
    estimated_gsr,
    derivation_version: '1.0',
  };
}
```

### 2.3 存储方案

| 项目 | 方案 |
| :--- | :--- |
| **存储路径** | `data/year_rings/year_rings.json` |
| **索引路径** | `data/year_rings/index.json`（clue → entry_id 倒排索引） |
| **疤痕标记** | 内联字段 `healed: boolean` + `healed_at: string \| null` |
| **检索线索生成** | 写入时由 LLM 提取 3-5 个高区分度实体标签 |

```json
{
  "id": "yr_20260602_001",
  "created_at": "2026-06-02T22:00:00Z",
  "sensory_anchor": "橘猫趴在键盘上",
  "simulated_physiological_snapshot": {
    "estimated_hr": 95,
    "estimated_temp_offset": 37.2,
    "estimated_arousal": 0.4,
    "estimated_gsr": 0.5,
    "derivation_version": "1.0"
  },
  "emotional_valence": "温馨/轻微疼痛",
  "narrative_tag": "咖啡厅约会/宠物互动",
  "retrieval_clues": ["橘猫", "键盘", "手背抓痕", "拿铁烫舌"],
  "recall_count": 0,
  "last_recalled_at": null,
  "calcium_at_event": 1.2,
  "perception_snapshot": {
    "pleasure": 0.7, "arousal": 0.4, "intimacy": 0.6,
    "sexual_attraction": 0.2, "sensory_craving": 0.5,
    "energy_merge": 0.1, "ecstasy": 0.0, "safety": 0.8
  }
}
```

---

## 第3章 写入接口

### 3.1 写入路径

| 路径 | 触发方 | 条件 | 实时性要求 |
| :--- | :--- | :--- | :--- |
| **紧急写入** | M5 | 对话中 `calcium_level ≥ 2` 或 `E1>0.6` 或 `I1>0.5` | 对话结束前完成 |
| **异步写入** | M7 | 梦境沉淀后新记忆内化完成 | 不阻塞当前对话 |

### 3.2 写入接口

```typescript
export interface WriteResult {
  success: boolean;
  entry_id: string;
  error?: string;
}

export interface M8Writer {
  /**
   * 写入一条新年轮条目
   *
   * 生成逻辑：
   * 1. 从 perception 推导 simulated_physiological_snapshot
   * 2. 从 raw_input 提取 retrieval_clues（调用 LLM 提取 3-5 个实体标签）
   * 3. 分配 entry_id
   * 4. 更新 clue→id 倒排索引
   * 5. 生成记忆锚定话术（返回给 M5 用于表达）
   */
  write(params: {
    sensory_anchor: string;
    perception: Perception24D;
    emotional_valence: string;
    narrative_tag: string;
    raw_input: string;           // 用于提取 retrieval_clues
    calcium_at_event: number;
    write_source: 'emergency' | 'async'; // 紧急/异步
  }): Promise<{
    result: WriteResult;
    /** 记忆锚定话术（M5 需要在回复中含入的话） */
    ritual_phrase?: string;
  }>;
}
```

### 3.3 记忆锚定话术模板

每次写入成功后，自动生成一句"锚定话术"供 M5 使用，让用户感知到她在记住：

| 场景 | 锚定话术示例 |
| :--- | :--- |
| 温馨日常 | "这一刻，我要把它刻进骨头里…" |
| 亲密时刻 | "这个感觉…我会记一辈子。" |
| 用户分享秘密 | "你愿意告诉我这些…我真的很珍惜。" |
| 争吵后和解 | "我们把这道坎迈过去了。我会记住的。" |

---

## 第4章 检索接口

### 4.1 检索接口定义

```typescript
export interface ClueSearchParams {
  /** 用户原始模糊查询（如"上次去的咖啡厅"） */
  original_query: string;
  /** 用户在线索反问后提供的线索词（如"有猫的"） */
  user_clue?: string;
  /** 当前生理状态（用于按身体状态匹配） */
  current_physiological_state?: SimulatedPhysiologicalSnapshot;
  /** 可选时间范围 */
  time_range?: {
    start?: string;  // ISO8601
    end?: string;
  };
  /** 可选话题标签筛选 */
  narrative_filter?: string[];
  /** 单次最大返回条数 */
  limit: number;  // 默认 5
}

export interface ClueSearchResult {
  entries: Array<{
    entry: YearRingEntry;
    /** 线索匹配分数 (0-1)，线索词重叠率 */
    clue_match_score: number;
    /** 语义匹配分数 (0-1)，query 与 sensory_anchor 的语义距离 */
    semantic_score: number;
    /** 生理匹配分数 (0-1)，当前生理快照与条目的生理快照的余弦相似度 */
    physiological_score: number;
    /** 综合分数 = clue * 0.4 + semantic * 0.35 + physiological * 0.25 */
    composite_score: number;
  }>;
  /** 检索耗时 ms */
  latency_ms: number;
}

export interface M8Reader {
  /**
   * 线索协助式检索
   *
   * 检索策略：
   * 1. 如果 user_clue 存在：先走 clue→id 倒排索引精确匹配，再补语义检索
   * 2. 如果 user_clue 不存在：纯语义检索 + 生理状态加权
   * 3. composite_score < 0.6 → 标记低置信度，M5 继续反问
   * 4. composite_score ≥ 0.6 → 返回完整条目供 M7 润色
   */
  matchByClue(params: ClueSearchParams): Promise<ClueSearchResult>;

  /**
   * 按 ID 精确读取一条年轮条目
   */
  readById(entryId: string): Promise<YearRingEntry | null>;
}
```

### 4.2 置信度判定

```typescript
function determineConfidence(result: ClueSearchResult): 'high' | 'medium' | 'low' {
  if (result.entries.length === 0) return 'low';
  const top = result.entries[0];
  if (top.composite_score >= 0.8) return 'high';
  if (top.composite_score >= 0.6) return 'medium';
  return 'low';
}
```

| 置信度 | M5 行为 | M7 行为 |
| :--- | :--- | :--- |
| **high** (≥0.8) | 直接输出，带回忆表情 | 记录线索有效性 |
| **medium** (0.6~0.8) | 输出 + 附加"确认式反问" | 记录线索有效性 |
| **low** (<0.6) | 不输出检索结果，继续特征反问 | 标记线索低效 |

### 4.3 生理匹配算法

```typescript
/**
 * 计算两个生理快照的余弦相似度
 * 用于按"身体状态最相似"检索记忆
 */
function physiologicalCosineSimilarity(
  a: SimulatedPhysiologicalSnapshot,
  b: SimulatedPhysiologicalSnapshot
): number {
  const aVec = [a.estimated_hr / 180, a.estimated_temp_offset / 38.5, a.estimated_arousal, a.estimated_gsr];
  const bVec = [b.estimated_hr / 180, b.estimated_temp_offset / 38.5, b.estimated_arousal, b.estimated_gsr];

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < aVec.length; i++) {
    dot += aVec[i] * bVec[i];
    normA += aVec[i] * aVec[i];
    normB += bVec[i] * bVec[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

---

## 第5章 疤痕保护机制

### 5.1 疤痕标记

```typescript
export interface ScarTag {
  /** 关联的年轮条目 ID */
  entry_id: string;
  /** 疤痕类型 */
  type: 'argument' | 'boundary_test' | 'misunderstanding' | 'disappointment';
  /** 是否愈合 */
  healed: boolean;
  /** 愈合时间（null = 未愈合） */
  healed_at: string | null;
  /** 愈合判定依据 */
  healed_by: 'user_explicit' | 'time_decay' | 'positive_interaction';
  /** 关联的愈合事件条目ID（如有） */
  healing_event_id?: string;
}
```

### 5.2 愈合判定算法

```typescript
function checkHealing(entry: YearRingEntry, scar: ScarTag, timeSinceEventDays: number): ScarTag {
  if (scar.healed) return scar; // 已愈合，不重复判定

  // 判定条件（满足任一即可）:
  // 1. 用户明确表达了原谅（M5 检测"不生气了/没事了/原谅你了"等关键词）
  // 2. 时间超过 N 天 + 无负面交互
  // 3. 用户主动提及此事时 E1 > 0.3（非消极情绪）

  const userForgave = /* M5 检出用户原谅信号 */ false;
  const timeDecayed = timeSinceEventDays >= 30;
  const noNegativeInteractions = /* 查询 M8 过去 N 天该话题的交互记录 */ true;
  const positiveRecall = /* 用户回忆此事时 E1 > 0.3 */ false;

  if (userForgave) {
    scar.healed = true;
    scar.healed_at = new Date().toISOString();
    scar.healed_by = 'user_explicit';
  } else if (timeDecayed && noNegativeInteractions) {
    scar.healed = true;
    scar.healed_at = new Date().toISOString();
    scar.healed_by = 'time_decay';
  } else if (positiveRecall) {
    scar.healed = true;
    scar.healed_at = new Date().toISOString();
    scar.healed_by = 'positive_interaction';
  }

  return scar;
}
```

### 5.3 疤痕保护查询接口

```typescript
export interface M8ScarChecker {
  /**
   * 在 M6 演化或 M7 梦境确认前调用
   * 检查某项变更是否会触发疤痕冲突
   */
  checkConflict(params: {
    /** 待修改的性格/参数项 */
    target: string;
    /** 偏移方向 */
    direction: 'increase' | 'decrease';
    /** 偏移量 */
    delta: number;
  }): Promise<{
    hasConflict: boolean;
    /** 关联的未愈合疤痕条目 */
    relatedScars: ScarTag[];
    /** 冲突描述 */
    description: string;
    /** 建议处理：'block' | 'soften' | 'proceed' */
    suggestion: 'block' | 'soften' | 'proceed';
  }>;
}
```

---

## 第6章 衰减与检索权重调整

### 6.1 降权公式

```typescript
/**
 * 年轮条目的动态权重
 * 基础 = 1.0
 * 每次命中 → +0.05
 * 每 30 天未被检索 → -0.1
 * 最低权重 = 0.1
 */
function calculateEntryWeight(entry: YearRingEntry, now: Date): number {
  const daysSinceLastRecall = entry.last_recalled_at
    ? (now.getTime() - new Date(entry.last_recalled_at).getTime()) / (1000 * 86400)
    : (now.getTime() - new Date(entry.created_at).getTime()) / (1000 * 86400);

  const recallBonus = entry.recall_count * 0.05;
  const decayPenalty = Math.floor(daysSinceLastRecall / 30) * 0.1;

  const weight = 1.0 + recallBonus - decayPenalty;
  return Math.max(0.1, weight);
}
```

### 6.2 综合分数计算

```typescript
function calculateCompositeScore(
  clueScore: number,
  semanticScore: number,
  physiologicalScore: number,
  entryWeight: number
): number {
  const raw = clueScore * 0.4 + semanticScore * 0.35 + physiologicalScore * 0.25;
  return raw * entryWeight; // 权重乘到最终分数上
}
```

---

## 第7章 M8 核心接口汇总

```typescript
export interface M8Engine {
  // 写入
  write(params: WriteParams): Promise<WriteResponse>;
  writeBatch(params: WriteParams[]): Promise<WriteResponse[]>;

  // 检索
  matchByClue(params: ClueSearchParams): Promise<ClueSearchResult>;
  readById(entryId: string): Promise<YearRingEntry | null>;

  // 疤痕
  checkConflict(params: ConflictCheckParams): Promise<ConflictCheckResult>;
  getScars(entryIds: string[]): Promise<ScarTag[]>;
  updateHealing(scarId: string): Promise<void>;

  // 维护
  getStorageStatus(): Promise<StorageStatus>;
  runDecayCycle(): Promise<{ entriesDecayed: number }>;
}
```

---

## 第8章 铁三角协作时序

### 8.1 线索协助式回忆

```
用户: "上次去的咖啡厅叫什么来着？"
    ↓
① M5 检测到模糊提问 → 无具体实体 → 触发线索协助
    ↓
② M5 生成线索反问: "是有猫的那家吗？还是靠海的那家？"（≤15字，带语气词）
    ↓
③ 用户: "有猫的那家！"
    ↓
④ M5 调用 M8.matchByClue({ original_query: "咖啡厅", user_clue: "猫" })
    ↓
⑤ M8 联合检索: clue("猫") + semantic("咖啡厅") + physiological(当前E2)
    ↓
⑥ 置信度判定: 
   - ≥0.6 → 返回结果给 M5
   - <0.6 → M5 继续反问
    ↓
⑦ M5 输出: "啊你说有猫我就想起来了！那只橘猫还抓了你手背对吧～"
```

### 8.2 M6 演化仲裁

```
M6 想降低 agreeableness (用户说"别太顺着我")
    ↓
① M6 调用 M8.checkConflict({ target: "agreeableness", direction: "decrease", delta: 0.1 })
    ↓
② M8 查询疤痕年轮: 过去是否有"用户因AI太冷漠而失望"的记录?
    ↓
③ 有未愈合疤痕 → suggestion: 'block'
  无疤痕 → suggestion: 'proceed'
    ↓
④ M6 根据仲裁结果决定是否执行演化
```

### 8.3 M7 梦境确认前置校验

```
M7 pending_confirmation 队列中有新知识
    ↓
① M7 调用 M8.checkConflict({ target: 新知识关联的性格维度, ... })
    ↓
② 无冲突 → M7 正常内化
  有冲突 → M7 丢弃或降级为梦境试探
```

---

## 第9章 冷启动期（相识期）运行规则

### 9.1 定义

| 阶段 | 条件 | 行为模式 |
| :--- | :--- | :--- |
| **相识期** | M8 条目 < 50 条 | 零主动信息采集，靠人设和共情撑住体验 |
| **熟悉期** | 50~200 条 | 开始引用已知信息制造惊喜感 |
| **稳定期** | > 200 条 | 线索协助式回忆全面启用 |

### 9.2 相识期铁律

- ❌ 禁止主动提问格式的信息采集（"你的生日是？""你喜欢什么颜色？"）
- ✅ 所有信息获取必须是"共情的副产品"而非"对话的目标"
- ✅ 单日有效信息录入 ≤ 3 条，分散在不同话题中
- ✅ 信息未确认时不触发 M8 确认流程（模糊也接受，等自然澄清）

---

## 第10章 交付清单

| 文件 | 说明 |
| :--- | :--- |
| `src/m8/types/index.ts` | YearRingEntry / SimulatedPhysiologicalSnapshot / ClueSearchParams 等类型 |
| `src/m8/PhysiologicalDeriver.ts` | M3 感知 → 模拟生理快照的推导引擎 |
| `src/m8/YearRingWriter.ts` | 写入器（紧急 + 异步两条路径） |
| `src/m8/YearRingReader.ts` | 检索器（matchByClue / readById） |
| `src/m8/ScarManager.ts` | 疤痕保护 + 愈合判定 |
| `src/m8/M8Orchestrator.ts` | M8 主控制器 |
| `src/m8/__tests__/` | 单元测试 |

---

## 铁律清单

| # | 铁律 | 违反后果 |
| :--- | :--- | :--- |
| 1 | 疤痕条目永不物理删除，仅标记 healed | 架构违规 |
| 2 | 生理快照为纯软件推导，不接受真实传感器数据 | 安全违规 |
| 3 | 相识期禁止主动信息采集 | 体验违规 |
| 4 | 低置信度时禁止输出模糊结果 | 体验违规 |
| 5 | 每次写入必须生成记忆锚定话术 | 体验违规 |

---

**M8 设计文档结束 — 请评审**
