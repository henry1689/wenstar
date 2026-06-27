---
name: test-data-discipline
description: 测试数据清理铁律（已自动常驻）
---

# 测试数据清理 · Test Data Discipline

## 状态：🟢 已自动常驻（无需调用）

此规则已写入 `CLAUDE.md` 永久行为规则第 4 条，测试结束后自动提醒。**不再需要手动调用。**

## 铁律

**所有模拟输入词和测试语句，修完后必须清除，不得残留。** 测试数据会污染三库（金库/知识库/实体关系），导致后续开发调试时产生幻觉——玉瑶说出错误记忆、景幻仙姑翻出不存在的人物关系。

---

## 测试产生的四类污染

| 污染类型 | 存储位置 | 后果 |
|:---------|:---------|:-----|
| 对话记录 | `conversations.json` | 玉瑶"记得"测试中的对话 |
| 知识条目 | `knowledge_base` 表 | 知识库有假信息 |
| 实体关系 | `entities` + `entity_relations` 表 | 误以为存在某个"人" |
| 黑钻事件 | `black_diamond_events` 表 | 景幻仙姑检索出假事件 |

## 修复后的清理脚本模板

```typescript
// 三种清理方式根据污染程度选择:

// 方式1 - 按关键词清除知识库
DELETE FROM knowledge_base WHERE title LIKE '%测试关键词%';

// 方式2 - 清除实体
DELETE FROM entity_relations WHERE entity_a_id IN (SELECT id FROM entities WHERE name = '误配名');
DELETE FROM entities WHERE name = '误配名';

// 方式3 - 清除对话
// 手动编辑 conversations.json，移除含测试关键词的记录
```

## 预防措施

1. 测试尽量用 `node -e` 或 `python -c` 直接调函数，不走完整 API 链路
2. 如果必须走 API，测试请求加标记字段（如 `"_test": true`），方便后续清理
3. 每次修改涉及 `extractRelations` 或 `proactivePatterns` 的代码后，检查是否有误提取
4. 全系统验证时如果发现异常记忆，优先怀疑测试残留

## 引用

关联记忆：[[system-integration-20260609]]
