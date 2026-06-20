# 人物存储架构说明书

> 最后更新: 2026-06-20
> 设计原则: 家族图谱（family_graph.db）是"人"的唯一真实来源，其他任何地方都不应独立存人。

---

## 一、架构总览

```
用户消息
  │
  ├── M1 实体提取（规则 + LLM NER）
  │   entity_rules.json 提取"妈妈/同事/开心/工作"
  │   LLM NER 提取"熊勇/陈锋华/徐诗雨"
  │   → dna.entity_genes
  │
  ├──▶ 主路径: M4 → FamilyGraph
  │   M4Orchestrator.orchestrate() 第43行
  │   → familyGraph.integrateFromEntity(entities, raw_input)
  │      ├── 有亲属词 → 家族边 (mother_of/father_of/spouse_of)
  │      └── 无亲属词 → 社交边 (acquaintance_of)
  │
  └──▶ 备份路径: chat.ts → FamilyGraph
      chat.ts 第475行
      → familyGraph.integrateSocialRelation(name, acquaintance_of, message)
      双保险：即使 M4 不工作，人名也不丢失

  → 最终存储: family_graph.db (唯一位置)
```

---

## 二、数据库

### 唯一的库: family_graph.db

| 路径 | `data/webui/knowledge/family_graph.db` |
|------|----------------------------------------|
| 管理类 | `src/m4/FamilyGraph.ts` |
| 节点表 | `nodes (id, type, name, aliases, properties, created_at, updated_at)` |
| 边表 | `edges (id, source_id, target_id, relation, properties, created_at, updated_at)` |
| 落盘策略 | **立即落盘** — addNode/addEdge/updatePersonProfile 全部立即 writeFileSync |

### 不存人的库: fusion_memory.db

| 表 | 说明 | 是否存人 |
|----|------|---------|
| `entities` | M2 存储层自动写入，不可禁用 | ✅ 会存但不应查询 |
| `entity_relations` | 旧代码遗迹，新代码不写 | ✅ 遗留数据 |
| `knowledge_base` | 知识库只存文件/资料 | ❌ 不存人（已禁用） |

> **fusion_memory.db 的 entities 表仍在写入（M2 SQLiteAdapter.ensureEntity），但这属于存储层内部实现，不应作为人的查询来源。**

---

## 三、M1 实体提取

### 两条路径

```
用户文本 → "陈锋华是我表哥，他是做业务的"
  │
  ├── ① entity_rules.json（纯规则，75条）
  │    匹配"表哥" → {name:"表哥", type:"person"}
  │    匹配"工作" → {name:"工作", type:"event"}
  │    零成本，本地 FMM 分词
  │
  └── ② LLM NER（DeepSeek Chat，5s超时，temperature=0）
       三层过滤：
         ① prompt强约束 — 只识别人名/情绪/事件
         ② 类型白名单(person/emotion/event)
         ③ person人名正则校验(300姓氏+XX总)
       缓存3分钟
       超时降级 → 正则兜底(同事/妈妈/搭档等)
```

### 兜底正则词库

在 `LLMEntityExtractor.ts` 第 125-132 行：

```typescript
person: 妈妈/爸爸/老公/老婆/同事/同学/朋友/老板/搭档/合伙人/...
emotion: 开心/难过/焦虑/愤怒/思念/委屈/压力/累/...
event: 工作/结婚/考试/旅行/吵架/加班/跑步/...
```

---

## 四、两条写入路径

### 主路径: M4 → FamilyGraph

```
chat.ts 第1076行 → ctx.m4.orchestrate(decision)
                                       ↓
M4Orchestrator.ts 第43行 → familyGraph.integrateFromEntity(entities, raw_input)
                              │
                              ├── 有亲属词 → 创建 nodes 家族边 + 反向边
                              │               mother_of + child_of
                              │               father_of + child_of
                              │               spouse_of + spouse_of
                              │               sibling_of + sibling_of
                              │
                              └── 无亲属词 → 创建 nodes 社交边
                                               acquaintance_of
```

### 备份路径: chat.ts → FamilyGraph

```
chat.ts 第475行 → familyGraph.integrateSocialRelation(name, acquaintance_of, message)
                  双保险：主路径未覆盖时补写入
```

---

## 五、不再存在的路径（已删除）

| 路径 | 删除时间 | 删除原因 |
|------|---------|---------|
| ❌ GlobalScan 姓氏滑窗 | 2026-06-20 | 误报多("贝安""老说同")，模糊人名改由 LLM NER 处理 |
| ❌ knowledge_base 写入"人物:XX" | 2026-06-20 | 知识库不存人，人物统一归家族图谱 |
| ❌ L3 滑窗人名二次检测 | 2026-06-20 | 造成"贝安""老说同"等误报 |
| ❌ 公式化提问后缀 | 2026-06-20 | "（想起你刚刚提到XX）"太死板 |

---

## 六、排查指南

### 玉瑶"记不得"某人时

```
步骤1: 查家族图谱
  curl http://localhost:3000/api/social | grep "徐诗雨"
  → 存在 ✅ → 家族图谱有此人
  → 不存在 ❌ → 跳转步骤3

步骤2: 查 hallucinationGuard 是否冲突
  日志搜 "[FamilyGuard] 清除冲突"
  如果有 → 修复已生效
  如果没有 → 检查 familyConstraint 约束文本是否过严

步骤3: M1 是否提取到实体
  curl 发消息，看 response.m1.entities 里有没有这个人的 type:person
  → 有 ✅ → 问题在 M4
  → 空 ❌ → 问题在 LLM NER（查看 /tmp/ws.log 搜 "LLMEntity"）

步骤4: 查 LLM NER 是否超时
  /tmp/ws.log 搜 "extract timeout" 或 "提取失败"
  如果频繁超时 → 增大超时或检查 DeepSeek API 状态
```

### 家族图谱数据丢失

```
步骤1: 检查落盘
  family_graph.db 文件大小
  ls -la data/webui/knowledge/family_graph.db
  → 太小或不存在 → 检查 server.ts 中 FamilyGraph 初始化路径

步骤2: 检查写入
  FamilyGraph.ts 中 markDirty(true) 会立即 flush
  → 不应该丢数据
  → 如果丢 → 检查 family_graph.db 路径和 data/knowledge/ 的冲突
```
