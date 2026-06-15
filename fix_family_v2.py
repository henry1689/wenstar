"""Clean replacement of family guard with hard constraint."""
import sys

with open('src/webui/chat.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace the weak family guard block with hard constraint
old = """    // ── 家族/社交关系幻觉防护（铁律：必须以记录为准，不得编造） ──

    try {

      const personEntities = ctx_m4.family_context || ctx_m4.social_context || [];

      if (personEntities.length > 0) {

        const knownRelations = personEntities.map((p: any) => p.entity + '（' + p.relation + '）').join('、');

        if (knownRelations && !hallucinationGuard) {

          hallucinationGuard = '📋 以下是鸿鸣的家庭/社交关系，以实际记录为准：' + knownRelations + '。如果用户问到这些记录中没有的人或关系，不要假装知道，委婉说"不太记得了"。';

        }

      }

      const mentionedPerson = dna.entity_genes.find((g: any) => g.type === 'person' && g.name !== '我');

      if (mentionedPerson && personEntities.length === 0 && !hallucinationGuard) {

        const pName = mentionedPerson.name;

        hallucinationGuard = '⚠️ 用户提到了"' + pName + '"，但你不认识这个人。不要假装知道他是谁。如果用户问你是否记得，就说"这个人我好像没什么印象，你跟我讲讲呗？"';

      }

    } catch (err) { console.warn('[FamilyGuard] 防护构建失败:', err); }"""

new = """    // ── 家族/社交关系铁律（硬约束 — LLM 绝对不得编造，以 FamilyGraph 记录为准） ──
    let familyConstraint = '';
    try {
      const personEntities = ctx_m4.family_context || ctx_m4.social_context || [];
      if (personEntities.length > 0) {
        const knownList = personEntities.map((p: any) => '  - ' + p.entity + '（' + p.relation + '）').join('\\n');
        familyConstraint = '【家庭/社交关系铁律】以下是你对鸿鸣家庭和社交关系的全部所知：\\n' + knownList +
          '\\n\\n铁律（必须严格遵守）：' +
          '\\n1. 只有上面列出的人是鸿鸣告诉过你的，其他人你一概不知道、没见过、没听过。' +
          '\\n2. 对上面的人——你只知道他们的名字和与鸿鸣的关系，其他一切细节（工作、健康、习惯、性格、事件等）你都不知道。' +
          '\\n3. 绝对不要编造任何关于上面这些人的细节。不知道就说"你之前提过，但具体我不太记得了"。' +
          '\\n4. 如果鸿鸣主动告诉你更多信息，以他当时说的话为准。';
      } else {
        familyConstraint = '【家庭/社交关系铁律】你不知道鸿鸣有哪些家人和社交关系。如果鸿鸣提到任何人，你不知道他们是谁，直接说"这个人我之前没听你提过呀，是谁呀？"';
      }
    } catch (err) { console.warn('[FamilyGuard] 构建失败:', err); }"""

if old in content:
    content = content.replace(old, new)
    print("REPLACED: family guard with hard constraint")
else:
    print("ERROR: old guard block not found")
    sys.exit(1)

# 2. Add familyConstraint injection into finalKnowledgeText before M5 call
old_m5 = """        // 修复：将记忆碎片合并到知识库文本中（干净的三层注入）
        let memoryText = memoryFragments.length > 0 ? memoryFragments.slice(0, 2).join('\\n') : '';
        let finalKnowledgeText = knowledgeBaseText;"""

new_m5 = """        // 修复：将记忆碎片合并到知识库文本中（干净的三层注入）
        let memoryText = memoryFragments.length > 0 ? memoryFragments.slice(0, 2).join('\\n') : '';
        let finalKnowledgeText = knowledgeBaseText;
        // 家族/社交关系铁律注入（硬约束 — LLM 不得编造家庭成员细节）
        if (familyConstraint) {
          finalKnowledgeText = familyConstraint + '\\n\\n' + finalKnowledgeText;
        }"""

if old_m5 in content:
    content = content.replace(old_m5, new_m5)
    print("REPLACED: M5 area with familyConstraint injection")
else:
    print("ERROR: M5 area not found")
    sys.exit(1)

with open('src/webui/chat.ts', 'w', encoding='utf-8') as f:
    f.write(content)
print("SUCCESS: all changes applied")
