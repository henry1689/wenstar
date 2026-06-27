---
name: parallel-agent
description: 并行代理调度 — 多个独立子代理同时工作
---

# /parallel — 并行代理调度

## 触发条件

有多个互不依赖的任务需要独立完成时。

## 流程

### 第一步：任务拆分
- 确认每个任务独立（无文件冲突）
- 每个任务应有明确的输入和输出

### 第二步：并行执行

```javascript
// 在 Workflow 中的写法
const results = await parallel([
  () => agent("审查模块 A 的正确性", { label: "audit-A" }),
  () => agent("审查模块 B 的正确性", { label: "audit-B" }),
  () => agent("审查模块 C 的正确性", { label: "audit-C" }),
])
```

### 第三步：结果汇合
- 汇总各代理结果
- 处理冲突或不一致
- 输出综合报告

### 使用原则
- 四个任务以内直接并行
- 四个以上分批并行（4-4-4...）
- 有写操作时使用 `isolation: "worktree"`
