/**
 * SearchTool — 知识库搜索（包装 KnowledgeEngine）
 */
import type { KnowledgeItem } from '../../knowledge/types.js';
import type { ITool } from '../types.js';

type SearchFn = (keyword: string, limit: number) => Promise<KnowledgeItem[]>;

export function createSearchTool(searchFn: SearchFn): ITool {
  return {
    name: 'search',
    description: '知识库搜索：查询知识库内容',

    async execute(action: string, params: Record<string, any>): Promise<string> {
      if (action !== 'query') return `搜索工具不支持操作: ${action}`;
      const keyword = params.keyword || '';
      if (!keyword) return '请提供搜索关键词';
      const results = await searchFn(keyword, 5);
      if (results.length === 0) return `未找到与 "${keyword}" 相关内容`;
      return results.map((r: KnowledgeItem) =>
        `📄 ${r.title}: ${r.content.substring(0, 100)}`
      ).join('\n');
    },
  };
}
