# 人物存储排查指南

## 快速检查

```bash
# 社交图谱（非亲属）
curl http://localhost:3000/api/social | grep "徐诗雨"

# 家族图谱（亲属）
curl http://localhost:3000/api/family | grep "妈妈"

# 家族图谱完整画像
curl http://localhost:3000/api/family/熊勇

# M1 实体提取（直接发消息看实体）
curl -s -X POST http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"熊勇是我搭档","tts":false}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['m1']['entities'])"
```

## 常见问题

### ❌ 玉瑶说"这个人我没听你提过"
1. 查社交图谱：`curl /api/social | grep <人名>`
2. 有 → 约束文本冲突，检查 `hallucinationGuard`
3. 无 → 走步骤3

### ❌ M1 没提取到实体
1. 查 LLM NER 日志：`grep "LLMEntity" /tmp/ws.log`
2. 如果超时 → 在 `LLMEntityExtractor.ts` 增大 timeout
3. 如果正则兜底没覆盖 → 在 `REGEX_FALLBACK_RULES` 加词

### ❌ 家族图谱数据重启后丢失
1. 检查 `markDirty(true)` 是否生效
2. `family_graph.db` 有两个可能路径：
   - `data/webui/knowledge/family_graph.db` ✅（server.ts 用的）
   - `data/knowledge/family_graph.db` ❌（默认但未使用）

### ❌ 实体对但不该提取（"贝安""家里"误报）
1. 检查 `LLMEntityExtractor.ts` 的 `PERSON_BLACKLIST`
2. 检查 `isValidPersonName` 的人名正则
3. 加到 `PERSON_BLACKLIST`

## 数据流图

```
用户输入 → M1 → dna.entity_genes → M4 → FamilyGraph → family_graph.db
                                         ↘ chat.ts备份 → FamilyGraph
```

唯一存储：`family_graph.db`。`fusion_memory.db` 的 entities 表是 M2 内部实现，不查人。
