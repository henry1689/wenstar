# M5 逆向人文转译流水线 · 设计文档

> **文档状态**: Pre-Design Draft（待评审）  
> **关联规格书**: `docs/project-spec-v1.md` §1.4（规则优先 vs LLM）, §7（M5占位）  
> **关联白皮书**: 逆向人文转译协议（四步流水线）  
> **版本**: v0.1-design  
> **前置模块**: M3 (M3Decision), M4 (M4Context)  
> **核心定位**: 本系统**唯一允许调用 LLM 的模块**。LLM 是执行者，规则引擎才是创作者。

---

## 第1章 职责边界

### 1.1 M5 做什么

| 职责 | 说明 |
| :--- | :--- |
| **动作转语言** | 将 M3 的动作列表（`ask` / `comfort` / `act`）转化为自然语言回复 |
| **LLM 受控生成** | 唯一允许调用 LLM 的模块，但 LLM 在硬编码 Prompt 和规则约束下工作 |
| **人文校准** | 对 LLM 输出进行实体/情感/隐私/时效校验，失败时降级为保守表达 |
| **策略选择** | 根据钙质等级和动作类型，从预定义表达模板库中匹配策略 |

### 1.2 M5 不做什么

- ❌ 不修改 DNA
- ❌ 不进行 24 维感知（那是 M3 的事）
- ❌ 不存储（那是 M2 的事）
- ❌ 不允许 LLM 自由发挥（所有输出必须经过规则校验）

### 1.3 四步流水线总览

```
M4Context (含 M3Decision + 记忆摘要 + 家族知识)
    │
    ▼
┌─────────────────────────────────────┐
│ ① 认知组装 (纯函数, <20ms, 零LLM)   │
│    输入: M4Context                    │
│    输出: 结构化的认知对象 JSON        │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ ② 策略选择 (规则引擎, 零LLM)         │
│    输入: 认知对象 + 对话状态          │
│    输出: 策略ID + 参数集              │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ ③ LLM受控生成 (唯一LLM调用点)        │
│    输入: 认知对象 + 策略参数          │
│    输出: 初稿文本                    │
└──────────────┬──────────────────────┘
               ▼
┌─────────────────────────────────────┐
│ ④ 人文校准 (规则引擎, ≤30ms)        │
│    输入: 初稿 + 原始认知对象          │
│    输出: 最终回复                    │
└─────────────────────────────────────┘
```

---

## 第2章 认知组装（Step 1）

### 2.1 职责

将 M4Context 中的结构化数据，组装为统一的认知对象 JSON。

**输入**: `M4Context`
**输出**: `CognitionObject`

```typescript
export interface CognitionObject {
  /** 当前对话摘要 */
  current: {
    action: M3Action[];
    emotion_summary: string;       // 如 "用户表达了对家人的关心，带一丝焦虑"
    key_entities: string[];        // 关键实体名称
    calcium_level: number;         // 0~3
  };

  /** 历史记忆上下文 */
  history: {
    has_relevant_history: boolean;
    summary: string;               // 上下文压缩后的自然语言摘要
    time_span: string;             // 如 "过去3天内提及5次"
  };

  /** 家族知识上下文 */
  family?: {
    has_family_context: boolean;
    relationships: string[];       // 如 ["妈妈是用户的母亲", "用户住在深圳"]
  };

  /** 表达策略提示 */
  strategy_hint: {
    tone: 'warm' | 'neutral' | 'serious';    // 语气
    depth: 'shallow' | 'medium' | 'deep';     // 回应深度
    urgency: 'low' | 'medium' | 'high';        // 紧迫度
  };
}
```

### 2.2 策略提示推导规则

```typescript
function deriveStrategy(decision: M3Decision): CognitionObject['strategy_hint'] {
  const actions = decision.actions;
  const calciumLevel = decision.enhanced.calcium_level;

  // 语气
  let tone: 'warm' | 'neutral' | 'serious' = 'neutral';
  if (actions.includes('comfort')) tone = 'warm';
  if (actions.includes('act')) tone = 'serious';

  // 深度
  let depth: 'shallow' | 'medium' | 'deep' = 'shallow';
  if (calciumLevel >= 2) depth = 'medium';
  if (calciumLevel >= 3) depth = 'deep';

  // 紧迫度
  let urgency: 'low' | 'medium' | 'high' = 'low';
  if (actions.includes('comfort') || actions.includes('ask')) urgency = 'medium';
  if (actions.includes('act')) urgency = 'high';

  return { tone, depth, urgency };
}
```

### 2.3 约束

- **纯函数**: 相同输入永远返回相同输出
- **零LLM**: 没有任何 LLM 调用
- **性能**: < 20ms

---

## 第3章 策略选择（Step 2）

### 3.1 职责

根据认知对象和对话状态，从预定义表达模板库中选择最佳策略。

**输入**: `CognitionObject`
**输出**: `StrategyConfig`

```typescript
export interface StrategyConfig {
  /** 策略 ID，对应模板库中的一个模板 */
  strategy_id: string;

  /** 表达参数 */
  params: {
    tone: string;
    emotion_color?: string;     // 对应的情绪色号
    max_length: number;         // 目标回复长度
    include_entity: string[];   // 必须提及的实体
    include_history: boolean;   // 是否引用历史
    include_family: boolean;    // 是否引用家族知识
  };

  /** 策略描述（仅供调试/日志） */
  description: string;
}
```

### 3.2 策略路由表

| 动作 | 钙质等级 | 策略ID | 语气 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| `memorize` | 1 (液体) | `mem-general` | neutral | 简短确认，无需深度回应 |
| `ask` | 2 (固体) | `ask-curious` | warm | 好奇追问，主动表达兴趣 |
| `comfort` | 2 (固体) | `com-warm` | warm | 温暖支持，共情回应 |
| `memorize+ask` | 2 (固体) | `mem-ask` | warm | 先确认再追问 |
| `act` | 3 (晶体) | `act-core` | serious | 核心响应，全力投入 |

### 3.3 模板表达式（Prompt 占位符）

策略模板中可使用以下占位符，在 Step 3 由 LLM 填充：

| 占位符 | 替换来源 | 示例 |
| :--- | :--- | :--- |
| `{{EMOTION_SUMMARY}}` | CognitionObject.current.emotion_summary | "用户表达了对家人的关心" |
| `{{HISTORY_SUMMARY}}` | CognitionObject.history.summary | "你之前提到过妈妈最近身体不好" |
| `{{FAMILY_CONTEXT}}` | CognitionObject.family.relationships | "妈妈是你的母亲，住在深圳" |
| `{{KEY_ENTITIES}}` | CognitionObject.current.key_entities | "妈妈、深圳、健康" |
| `{{ACTION}}` | M3Action 列表 | "追问 + 安慰" |

---

## 第4章 LLM 受控生成（Step 3）

### 4.1 核心约束

| 约束项 | 要求 | 违反后果 |
| :--- | :--- | :--- |
| **LLM 隔离** | 必须经过 **LLMProvider** 接口，禁止直接调用 | 架构违规，不可验收 |
| **Prompt 硬编码** | Prompt 模板必须硬编码，禁止 LLM 修改自身指令 | 输出不可控 |
| **字段占位符** | 所有动态内容通过 `{{PLACEHOLDER}}` 注入 | 内容混入 Prompt 违例 |
| **Temperature** | 固定为 0.3（平衡创造力和一致性） | Tone 偏离预设 |
| **超时** | 超过 5 秒未返回 → 触发降级 | 影响用户体验 |

### 4.2 LLMProvider 接口

```typescript
export interface LLMProvider {
  /**
   * 根据策略配置和认知对象生成回复
   * 这是系统中唯一允许调用 LLM 的地方
   */
  generate(params: {
    strategy: StrategyConfig;
    cognition: CognitionObject;
  }): Promise<{ text: string; usage?: { prompt: number; completion: number } }>;
}
```

### 4.3 Prompt 模板示例（`ask-curious` 策略）

```text
你是一个温柔、理性的 AI 陪伴者 {{AI_NAME}}。
当前时间：{{CURRENT_TIME}}。

【用户当前表达】
{{EMOTION_SUMMARY}}
涉及实体：{{KEY_ENTITIES}}

【历史记忆上下文】
{{HISTORY_SUMMARY}}

【家族知识上下文】
{{FAMILY_CONTEXT}}

【表达要求】
- 语气：温暖、好奇
- 目标：对用户刚才提到的话题表达兴趣，主动追问细节
- 长度：不超过 {{MAX_LENGTH}} 字
- 需要提及的实体：{{INCLUDE_ENTITIES}}
- 如果是追问前面提到过的人或事，请引用历史记忆以显示你在意

请以 {{AI_NAME}} 的身份生成回复：
```

---

## 第5章 人文校准（Step 4）

### 5.1 职责

对 LLM 输出的初稿进行校验，确保符合系统约束。

**输入**: `CognitionObject` + LLM 初稿文本
**输出**: 最终回复文本（可能经过修正）

### 5.2 校验规则

| # | 校验项 | 规则 | 失败处理 |
| :--- | :--- | :--- | :--- |
| 1 | **实体准确性** | 初稿中提及的实体必须在 `CognitionObject.current.key_entities` 中存在 | 移除不确定的实体引用 |
| 2 | **情感匹配** | 初稿的情感基调与 `strategy_hint.tone` 一致 | 降级为中性保守表达 |
| 3 | **隐私保护** | 不包含姓名、地址等敏感信息 | 替换为泛化称呼 |
| 4 | **时效匹配** | 引用的历史事件时间戳与 `HISTORY_SUMMARY` 一致 | 移除时间引用 |
| 5 | **空校验** | 初稿不为空，不含无意义的重复 | 使用预设兜底话术 |

### 5.3 降级兜底

```typescript
const FALLBACK_RESPONSES: Record<M3Action, string[]> = {
  ignore: ['嗯', '好的'],
  memorize: ['我记住了', '好的，我记下了'],
  ask: ['能多说说吗？我想了解更多', '这很有趣，可以说详细点吗？'],
  comfort: ['我在这里陪着你', '没关系的，我理解'],
  act: ['我在', '好的，收到'],
};

function fallback(action: M3Action): string {
  const options = FALLBACK_RESPONSES[action];
  return options[Math.floor(Math.random() * options.length)];
}
```

---

## 第6章 M5 主控制器

### 6.1 输入输出

```
输入: M4Context
        ↓
  M5Orchestrator.orchestrate(M4Context)
        ↓
  ① CognitionAssembler.assemble() → 认知对象
  ② StrategySelector.select() → 策略配置
  ③ LLMProvider.generate() → 初稿
  ④ HumanisticCalibrator.calibrate() → 最终回复
        ↓
输出: string (最终回复)
```

### 6.2 异常处理

| 场景 | 处理 |
| :--- | :--- |
| LLM 超时（>5s） | 跳过 Step 3，直接从 Step 4 输出降级话术 |
| LLM 返回空文本 | 使用 `fallback(action)` 降级 |
| 校准失败率 > 50% | 全部降级为中性保守表达 |
| 认知组装失败 | 返回空字符串（上游 M3 已处理） |

---

## 第7章 与 M3 的接口转换

### 7.1 规则驱动 → 生成驱动

```
M3 侧（规则驱动）          M5 侧（生成驱动）
─────────────────         ─────────────────
M3Action[]                LLM Prompt
  ├─ ignore  ──────────►  不需要生成
  ├─ memorize ─────────►  "我记住了" + 摘要
  ├─ ask     ─────────►   好奇追问的 Prompt
  ├─ comfort ─────────►   温暖支持的 Prompt
  └─ act     ─────────►   核心响应的 Prompt
```

### 7.2 M3Action → 表达意图映射

| M3Action | 表达意图 | LLM Task |
| :--- | :--- | :--- |
| `ignore` | 无（直接跳过 M5） | — |
| `memorize` | 轻量确认 | 简短回应，不展开 |
| `ask` | 主动探索 | 生成追问，引用历史 |
| `comfort` | 情感支持 | 生成共情，温暖陪伴 |
| `act` | 核心行动 | 全力响应，坚定行动 |

---

## 第8章 交付清单

| 文件 | 说明 |
| :--- | :--- |
| `src/m5/types/index.ts` | CognitionObject / StrategyConfig / LLMProvider 接口 |
| `src/m5/CognitionAssembler.ts` | Step 1: 认知组装（纯函数） |
| `src/m5/StrategySelector.ts` | Step 2: 策略选择（规则引擎） |
| `src/m5/LLMProvider.ts` | Step 3: LLM 调用接口（抽象层，可切换实现） |
| `src/m5/MockLLMProvider.ts` | 测试用 Mock LLM 实现（返回模板填充后的文本） |
| `src/m5/HumanisticCalibrator.ts` | Step 4: 人文校准 + 降级兜底 |
| `src/m5/M5Orchestrator.ts` | M5 主控制器（编排四步流水线） |
| `src/m5/__tests__/` | 单元测试 |
| `docs/project-spec-v1.md` §7 | 更新为实际实现 |

---

**M5 设计文档结束 — 请评审**

*注：本文件仅描述设计。M5 涉及 LLM 调用，但测试阶段使用 MockLLMProvider，不依赖真实 API。*
