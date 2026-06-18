/**
 * LLMEntityExtractor — LLM 轻量辅助实体提取
 *
 * 原则: 命名实体识别(NER)是识别类工具，不是创造类工具。
 * LLM 只做"找出文本中的实体名+类型"，不产生新内容。
 *
 * 架构定位:
 * - 纯补漏作用：规则提取不到的人名/情绪/事件，LLM 补充
 * - 失败安全：超时/报错时静默降级到纯规则结果
 * - phenotype/knowledge_type 仍由规则标注（LLM 不参与判断类工作）
 *
 * Ref: M1-LLM-entity-plan.md
 */
import type { EntityType } from './types/dna.js';

export interface LLMExtractedEntity {
  name: string;
  type: EntityType;
}

/**
 * 使用 LLM 辅助提取文本中的实体（零样本NER）
 *
 * @param text - 用户原始输入
 * @param llmGenerate - LLM 生成函数（可选，不提供或失败时返回空数组）
 * @returns 提取到的实体列表（仅 name+type，不包含 phenotype/knowledge_type）
 */
export async function extractEntitiesLLM(
  text: string,
  llmGenerate?: (prompt: string) => Promise<string>
): Promise<LLMExtractedEntity[]> {
  if (!llmGenerate || !text || text.length < 2) return [];

  const prompt = `从以下中文文本中提取所有实体，只返回JSON格式。
实体类型: person(人名) / emotion(情绪) / event(事件) / place(地点) / object(物体/物品)

文本: "${text}"

JSON格式: {"entities":[{"name":"实体名","type":"实体类型"}]}

注意: 只返回JSON，不要其他文字。`;

  try {
    const result = await Promise.race([
      llmGenerate(prompt),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('LLM entity extraction timeout')), 3000)
      ),
    ]);

    // 尝试从结果中提取 JSON
    const jsonStr = extractJSON(result);
    if (!jsonStr) return [];

    const parsed = JSON.parse(jsonStr);
    if (parsed?.entities && Array.isArray(parsed.entities)) {
      return parsed.entities
        .filter((e: any) => e && typeof e.name === 'string' && e.name.length > 0 && e.type)
        .map((e: any) => ({ name: e.name, type: normalizeType(e.type) }));
    }
  } catch (err) {
    console.warn('[LLMEntity] 提取失败:', (err as Error).message);
  }
  return [];
}

/**
 * 从 LLM 回复中提取 JSON 部分（处理 LLM 可能返回 markdown 包裹的情况）
 */
function extractJSON(text: string): string | null {
  // 尝试 ```json ... ``` 格式
  const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlock) return jsonBlock[1].trim();
  // 尝试直接 JSON 对象
  const jsonObj = text.match(/\{[\s\S]*"entities"[\s\S]*\}/);
  if (jsonObj) return jsonObj[0];
  return null;
}

/**
 * 标准化实体类型（处理 LLM 可能返回的中文/英文混合）
 */
function normalizeType(type: string): EntityType {
  const lower = type.toLowerCase().trim();
  const map: Record<string, EntityType> = {
    person: 'person', 人名: 'person',
    emotion: 'emotion', 情绪: 'emotion', 情感: 'emotion',
    event: 'event', 事件: 'event',
    place: 'place', 地点: 'place', 场所: 'place',
    object: 'object', 物体: 'object', 物品: 'object',
  };
  return map[lower] || 'object';
}
