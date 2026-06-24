/**
 * FamilyGraphSync — 家族图谱 → 知识库人物档案同步
 *
 * 职责：
 *   ① 读取 FamilyGraph 中的人物画像
 *   ② 同步到知识库（人物档案类别）
 *   ③ 差异校验：自动对比知识库档案与主库数据
 *
 * 设计原则：
 *   - 知识库是"参考书架"，人物档案是其中一类参考资料
 *   - FamilyGraph 是结构化人物字典，是唯一真实来源
 *   - 同步是单向的：FamilyGraph → 知识库（从不反向）
 *   - 每次同步只更新有变化的人物，不做全量覆盖
 */

import type { FamilyGraph } from '../../m4/FamilyGraph.js';

interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  details: string[];
}

interface VerifyResult {
  fgPersonCount: number;
  kbPersonCount: number;
  matched: number;
  missingInKb: string[];
  profileMismatch: string[];
  consistent: boolean;
}

/**
 * 将 FamilyGraph 中的人物画像同步到知识库
 *
 * @param familyGraph FamilyGraph 实例
 * @param knowledgeEngine 知识库引擎
 * @param personNames 可选：不传则同步所有人，传则只同步指定人物
 */
export async function syncFamilyGraphToKnowledgeBase(
  familyGraph: any,
  knowledgeEngine: any,
  personNames?: string[],
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, created: 0, updated: 0, skipped: 0, errors: 0, details: [] };

  try {
    // 获取所有人物名
    const allNames = personNames ?? familyGraph.getAllPersonNames();
    const userPersonas = new Set(['我', '我自己', '玉瑶']);

    for (const name of allNames) {
      if (userPersonas.has(name)) continue; // 跳过系统自我

      try {
        const profile = familyGraph.getPersonProfile(name);
        if (!profile) {
          result.skipped++;
          continue;
        }

        // 构建摘要文本
        const summary = buildPersonSummary(name, profile);
        if (!summary) {
          result.skipped++;
          continue;
        }

        // 检查知识库是否已有此人记录
        const existing = await knowledgeEngine.search(name, 1);

        if (existing.length > 0 && existing[0]?.title?.includes(name)) {
          // 存在 → 检查是否需要更新
          const existingContent = existing[0].content || '';
          if (!existingContent.includes(summary.substring(0, 30))) {
            // 有新的画像信息 → 追加更新
            await knowledgeEngine.add({
              title: `人物档案: ${name}`,
              content: summary,
              source_type: 'family_graph',
              tags: ['人物档案', `person:${name}`],
              classification: '人物档案',
            });
            result.updated++;
            result.details.push(`更新: ${name}`);
          } else {
            result.skipped++;
          }
        } else {
          // 不存在 → 新建
          await knowledgeEngine.add({
            title: `人物档案: ${name}`,
            content: summary,
            source_type: 'family_graph',
            tags: ['人物档案', `person:${name}`],
            classification: '人物档案',
          });
          result.created++;
          result.details.push(`新建: ${name}`);
        }
        result.synced++;
      } catch (err) {
        result.errors++;
        result.details.push(`错误: ${name} — ${(err as Error).message}`);
      }
    }
  } catch (err) {
    result.errors++;
    result.details.push(`同步失败: ${(err as Error).message}`);
  }

  console.log(`[FG-Sync] 完成: ${result.synced} 人, 新建 ${result.created}, 更新 ${result.updated}, 跳过 ${result.skipped}, 错误 ${result.errors}`);
  return result;
}

/**
 * 校验 FamilyGraph 与知识库人物数据的一致性
 */
export async function verifyFamilyGraphSync(
  familyGraph: any,
  knowledgeEngine: any,
): Promise<VerifyResult> {
  const result: VerifyResult = {
    fgPersonCount: 0,
    kbPersonCount: 0,
    matched: 0,
    missingInKb: [],
    profileMismatch: [],
    consistent: false,
  };

  try {
    const allNames = familyGraph.getAllPersonNames().filter((n: string) => !['我', '我自己', '玉瑶'].includes(n));
    result.fgPersonCount = allNames.length;

    // 检查每个 FG 中的人物是否在知识库中
    for (const name of allNames) {
      const searchResults = await knowledgeEngine.search(name, 1);
      const found = searchResults.some((r: any) => r.title?.includes(name));

      if (found) {
        result.matched++;
        // 检查画像内容是否有显著差异
        const profile = familyGraph.getPersonProfile(name);
        if (profile) {
          const kbEntry = searchResults.find((r: any) => r.title?.includes(name));
          if (kbEntry?.content && profile.description) {
            // 如果知识库条目不包含人物的 relation_to_user，标记不匹配
            if (!kbEntry.content.includes(profile.relation_to_user || '')) {
              result.profileMismatch.push(name);
            }
          }
        }
      } else {
        result.missingInKb.push(name);
      }
    }

    result.consistent = result.missingInKb.length === 0 && result.profileMismatch.length === 0;
  } catch (err) {
    console.error('[FG-Sync] 校验失败:', err);
  }

  return result;
}

/**
 * 构建人物摘要文本（用于知识库条目）
 */
function buildPersonSummary(name: string, profile: any): string | null {
  const parts: string[] = [];

  if (profile.relation_to_user) parts.push(`关系: ${profile.relation_to_user}`);
  if (profile.appearance) parts.push(`外貌: ${profile.appearance}`);
  if (profile.body_features) parts.push(`身材: ${profile.body_features}`);
  if (profile.traits && profile.traits.length > 0) parts.push(`性格: ${profile.traits.join('、')}`);
  if (profile.personality) parts.push(`性格描述: ${profile.personality}`);
  if (profile.occupation) parts.push(`职业: ${profile.occupation}`);
  if (profile.interests && profile.interests.length > 0) parts.push(`兴趣: ${profile.interests.join('、')}`);
  if (profile.habits) parts.push(`习惯: ${profile.habits}`);
  if (profile.description) parts.push(`备注: ${profile.description}`);

  if (parts.length === 0) return null;

  return `${name}：${parts.join('；')}`;
}
