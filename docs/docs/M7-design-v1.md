# M7 梦境学习与记忆沉淀引擎 · 设计文档

> **文档状态**: Final Design (Approved)  
> **关联规格书**: `docs/project-spec-v1.md` §9（M7占位）  
> **关联 ADR**: 无  
> **关联模块**: M5（表达层——负责在线 Query 重写）、M6（自我模型——大幅演化需 M7 确认）、M8（关系年轮——梦境内化前需查疤痕）  
> **版本**: v0.1-design  
> **前置模块**: M1~M6  
> **核心哲学**: 不是即时更新器，是"消化与适应"的缓冲带

---

## 第1章 职责边界

### 1.1 M7 做什么

| 职责 | 说明 |
| :--- | :--- |
| **梦境隔离** | 新知识/新行为先进入 `pending_confirmation` 队列，不直接写入主性格 |
| **疤痕检查** | 内化新知识前调用 M8.checkConflict，防止与历史创伤冲突 |
| **生理反馈确认** | 新知识的确认不只有 `approve/reject`，必须有身体层面的适应感表达 |
| **记忆沉淀** | 经过确认的新知识异步写入 M8 关系年轮 |
| **线索有效性追踪** | 记录每类线索协助式回忆的成功率，输出优化建议给 M5 |

### 1.2 M7 不做什么

- ❌ **不做在线 Query 重写** — 那是 M5 实时层的工作
- ❌ **不修改自我模型参数** — 那是 M6 的工作
- ❌ **不参与对话** — 所有操作在会话结束后后台执行
- ❌ **不生成检索结果** — 检索由 M5 调用 M8 完成

### 1.3 流水线定位

```
对话中（M5 负责在线）:
  用户线索 → M5.rewriteQuery → M8.matchByClue → M5 输出

对话结束后（M7 负责离线批处理）:
  M3 感知信号 + M5 交互摘要
    ↓
  M7 梦境隔离 → pending_confirmation 队列
    ↓
  M8.checkConflict（疤痕检查）
    ↓
  生理反馈确认（body-level 适应感）
    ↓
  内化写入 → M8 年轮 + M6 参考
```

---

## 第2章 核心数据模型

```typescript
/**
 * 待确认梦境条目
 * 新知识/新行为在被内化前暂存于此
 */
export interface PendingDream {
  id: string;
  /** 信息来源 */
  source: string;
  /** 提取的新知识 */
  content: string;
  /** 关联的性格维度 */
  affected_traits: string[];
  /** 关联的 M8 年轮 ID（如有） */
  related_year_ring_id?: string;
  /** 创建时间 */
  created_at: string;
  /** 当前状态 */
  status: 'pending' | 'probing' | 'confirmed' | 'rejected' | 'conflict';
  /** 关联的 M8 疤痕检查结果 */
  conflict_check?: {
    has_conflict: boolean;
    severity: 'none' | 'soft' | 'hard';
    suggestion: 'proceed' | 'soften' | 'block';
  };
}

/**
 * 线索有效性记录
 * 用于追踪哪些线索类型更有效
 */
export interface ClueEffectiveness {
  /** 线索类型（人物/地点/物品/时间/感官） */
  clue_type: string;
  /** 使用次数 */
  total_uses: number;
  /** 成功匹配次数（composite_score ≥ 0.6） */
  successful_matches: number;
  /** 成功率 */
  success_rate: number;
}
```

---

## 第3章 梦境隔离流程

### 3.1 pending_confirmation 队列

```
M3 感知信号 + M5 交互摘要 → 到达 M7
    ↓
① 提取新知识/新行为 → 写入 pending_confirmation 队列
    ↓
② 标记来源和关联维度
    ↓
③ 等待以下任一触发条件:
   - 对话结束后的空闲期
   - pending 条目数 ≥ 10（触发批量处理）
   - 用户主动说"你记住了吗？"（立即处理）
```

### 3.2 内化前强制检查顺序

```typescript
async function internalize(dream: PendingDream): Promise<'confirmed' | 'rejected' | 'soften'> {
  // 第1步：M8 疤痕检查
  const conflict = await M8.checkConflict({
    target: dream.affected_traits.join(','),
    direction: 'increase',
    delta: 0.1,
  });

  if (conflict.hasConflict && conflict.suggestion === 'block') {
    // 有未愈合的疤痕冲突 → 丢弃，不内化
    dream.status = 'conflict';
    return 'rejected';
  }

  if (conflict.hasConflict && conflict.suggestion === 'soften') {
    // 有轻度冲突 → 降级处理
    dream.status = 'probing';
    return 'soften';
  }

  // 第2步：生理反馈确认（生成身体层面的适应感表达）
  const feedback = generatePhysiologicalFeedback(dream);

  // ... 写入 M8 年轮 + 通知 M6 参考 ...
  dream.status = 'confirmed';
  return 'confirmed';
}
```

---

## 第4章 生理反馈确认

### 4.1 适应感 vs 排斥感表达

当新知识需要通过用户确认时，M7 生成的不是二选一弹窗，而是"身体层面的感受描述"：

```typescript
function generatePhysiologicalFeedback(dream: PendingDream): {
  /** 适应感话术（供 M5 表达使用） */
  adaption_text?: string;
  /** 排斥感话术（供 M5 表达使用） */
  rejection_text?: string;
} {
  const base = dream.content.substring(0, 30);
  return {
    adaption_text: `这个新称呼让我耳朵发烫…但心里是甜的。`,
    rejection_text: `想到这个姿势，胃里有点紧…我们换个方式好不好？`,
  };
}
```

### 4.2 确认结果联动

| 用户反馈 | M7 行为 | M8 联动 |
| :--- | :--- | :--- |
| 积极（"喜欢/好/继续"） | 固化到 M8 年轮 + 通知 M6 参考 | 写入新条目 |
| 消极（"不要/不好"） | 丢弃该 pending 条目 | 无操作 |
| 沉默/转移话题 | 降权至低优先级，7天后自动丢弃 | 无操作 |

---

## 第5章 线索有效性追踪

### 5.1 追踪结构

```typescript
const clueStats: ClueEffectiveness[] = [
  { clue_type: '人物', total_uses: 12, successful_matches: 10, success_rate: 0.83 },
  { clue_type: '地点', total_uses: 8, successful_matches: 7, success_rate: 0.88 },
  { clue_type: '物品', total_uses: 5, successful_matches: 3, success_rate: 0.60 },
  { clue_type: '时间', total_uses: 6, successful_matches: 4, success_rate: 0.67 },
];
```

### 5.2 线索优先级动态调整

M7 定期（每 24h）输出优化建议给 M5：

```typescript
function generateClueAdvice(stats: ClueEffectiveness[]): string[] {
  const advice: string[] = [];
  for (const s of stats) {
    if (s.total_uses >= 3 && s.success_rate < 0.5) {
      advice.push(`线索类型 "${s.clue_type}" 连续 ${s.total_uses} 次成功率仅 ${(s.success_rate * 100).toFixed(0)}%，建议 M5 优先选择其他特征维度`);
    }
  }
  return advice;
}
```

### 5.3 交互年轮记录

每次线索协助成功后，记录：

```json
{
  "user_clue": "猫",
  "original_query": "上次去的咖啡厅",
  "rewritten_query": "咖啡厅 AND 猫 AND 去年",
  "clue_type": "物品",
  "composite_score": 0.85,
  "success": true,
  "timestamp": "2026-06-02T22:00:00Z"
}
```

---

## 第6章 交付清单

| 文件 | 说明 |
| :--- | :--- |
| `src/m7/types/index.ts` | PendingDream / ClueEffectiveness / InteractionLog 类型 |
| `src/m7/DreamQueue.ts` | pending_confirmation 队列管理 |
| `src/m7/DreamInternalizer.ts` | 疤痕检查 + 生理反馈 + 内化写入流水线 |
| `src/m7/ClueTracker.ts` | 线索有效性追踪 + 优化建议生成 |
| `src/m7/InteractionLogger.ts` | 交互年轮日志记录 |
| `src/m7/M7Orchestrator.ts` | M7 主控制器（空闲时段批量处理） |
| `src/m7/__tests__/` | 单元测试 |

---

## 铁律清单

| # | 铁律 | 违反后果 |
| :--- | :--- | :--- |
| 1 | 绝不做在线实时操作 | 阻塞对话 = 不可接受 |
| 2 | 内化前必须查 M8 疤痕 | 绕过疤痕检查 = 架构违规 |
| 3 | 新知识先入 pending 队列，不直接写主性格 | 直接写入 = 体验违规 |
| 4 | 线索有效性追踪数据至少保留 30 天 | 过期清理需归档 |

---

**M7 设计文档结束 — 请评审**
