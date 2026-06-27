---
name: finish-branch
description: 分支收尾 — 自动测试/审查/生成总结/提PR
---

# /finish-branch — 分支收尾

## 触发条件

功能开发完成，准备提交和推送时。

## 流程

### 第一步：检查变更
```bash
git status
git diff --stat
```

### 第二步：运行测试
```bash
npx tsc --noEmit && npx vitest run
```

### 第三步：审查变更
对当前 diff 做代码审查。

### 第四步：整理提交
- 编写规范的 commit message
- 确认无遗留调试代码/临时文件
- 清理 `.debug-*` / `/tmp` 等临时文件

### 第五步：生成总结

```markdown
## 分支完成：<branch-name>

### 变更摘要
- N 个文件，+M/-K 行
- 关键改动：...

### 通过验证
- [x] 编译通过
- [x] 全部测试
- [x] 代码审查通过

### 下一步
- 合并到主分支？
- 推送到远程？
- 删除本地分支？
```
