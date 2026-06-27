---
name: subagent-dev
description: 子代理驱动开发 — 每个子任务独立代理实现 + 自动审查验证
---

# /subagent-dev — 子代理驱动开发

## 触发条件

计划已写好（/write-plan），有多个独立子任务需要实现时。

## 核心原则

**每个子任务 = 一个独立子代理**，互不干扰，自带质量门禁。  
子代理之间**不共享上下文**，避免上下文污染和注意力分散。

## 流程

### 第一步：任务拆分

把实现计划拆成**每个子任务 2-5 分钟**的粒度，每个子任务：
- 有明确的文件路径
- 有明确的输入/输出
- 有明确的验证命令
- **不改动其他子任务的文件**（否则串行执行）

### 第二步：并行调度

```javascript
// Workflow 写法示例
const tasks = [
  { name: '实现类型定义', file: 'src/types.ts', cmd: 'npx tsc --noEmit' },
  { name: '实现核心逻辑', file: 'src/logic.ts', cmd: 'npx vitest run logic.test.ts' },
  { name: '实现 API 路由', file: 'src/api.ts', cmd: 'npx vitest run api.test.ts' },
]

const results = await parallel(tasks.map(t => () =>
  agent(`实现 ${t.name}，文件 ${t.file}。完成后运行 ${t.cmd} 验证。`, {
    label: t.name,
    phase: '实现',
  })
))
```

### 第三步：质量门禁

每个子代理完成后必须通过：
- [ ] **编译检查** — `npx tsc --noEmit` 或等效
- [ ] **测试通过** — 相关的单元测试/集成测试
- [ ] **无调试残留** — 没有 `console.log`、`.debug-*` 临时文件

### 第四步：冲突检查

全部子代理完成后，整体验证：
1. 合并所有变更
2. `npx tsc --noEmit` 全量编译
3. 运行全部测试

### 第五步：汇总输出

```markdown
## 子代理开发报告

| 子任务 | 状态 | 验证结果 |
|--------|------|---------|
| 类型定义 | ✅ | tsc 通过 |
| 核心逻辑 | ✅ | 测试通过 (3/3) |
| API 路由 | ❌ | 测试失败 → 已修复 |

### 整体验证
- [x] 全量编译通过
- [x] 全部测试通过
```

## 限制

- 有文件冲突的子任务必须串行（或使用 `isolation: "worktree"`）
- 最多同时运行 10 个子代理（系统限制）
