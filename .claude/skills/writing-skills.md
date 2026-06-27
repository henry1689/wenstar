---
name: writing-skills
description: 编写新技能 — 扩展你的 Claude Code 技能库
---

# /writing-skills — 编写技能

## 触发条件

需要创建新的自定义技能时。

## 格式

Skills 放在 `.claude/skills/` 目录下，Markdown 文件：

```markdown
---
name: skill-name
description: 一句话描述
---

# /skill-name — 标题

## 触发条件
...

## 流程
...

### 第一步
...

### 第二步
...
```

## 原则

1. **明确触发条件** — 什么时候该用
2. **可操作流程** — 具体步骤，不要含糊
3. **模板化输出** — 输出格式固定，方便复用
4. **可验证** — 有验证命令和检查清单
