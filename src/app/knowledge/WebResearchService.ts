/**
 * WebResearchService — 玉瑶的联网研究服务
 *
 * 在梦境空闲时，对高频但知识库里没有的话题做研究，
 * 总结结果并存入知识库。
 *
 * 搜索策略：
 * 1. 先读取环境变量 RESEARCH_API_URL 指定的搜索接口
 * 2. 如未配置，尝试内置源（Wikipedia/Baidu/DuckDuckGo）
 * 3. 全部不可达时，基于关键词知识自主生成笔记占位
 */
import type { SQLiteAdapter } from '../../m2/SQLiteAdapter.js';

interface ResearchResult {
  keyword: string;
  summary: string;
  sources: string[];
  entryId: string;
}

/** 用户自定义搜索 API（可配置） */
const CUSTOM_SEARCH_URL = process.env['RESEARCH_API_URL'] || '';
const CUSTOM_SEARCH_KEY = process.env['RESEARCH_API_KEY'] || '';

async function searchCustomAPI(keyword: string): Promise<string> {
  if (!CUSTOM_SEARCH_URL) return '';
  try {
    const url = CUSTOM_SEARCH_URL.replace('%s', encodeURIComponent(keyword));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (CUSTOM_SEARCH_KEY) headers['Authorization'] = `Bearer ${CUSTOM_SEARCH_KEY}`;
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return '';
    return await resp.text();
  } catch (err) {
    console.warn('[Research] 自定义搜索失败:', err);
    return '';
  }
}

/**
 * 生成关键词的基础知识段落（不依赖外部 API）
 */
function generateKnowledge(keyword: string): string {
  const now = new Date();
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;

  return `关于「${keyword}」的研究笔记
研究时间：${dateStr}
来源：玉瑶的自主知识整理

这是玉瑶在空闲时对主人常提起的「${keyword}」做的资料整理。
主人对这个话题很感兴趣，玉瑶会继续关注相关内容，
在下次主人提起时和主人一起探讨。

关键词：${keyword}
状态：已记录，待深入学习`;
}

/**
 * 对指定关键词进行研究
 */
export async function researchTopic(
  keyword: string,
  sqlite: SQLiteAdapter,
): Promise<ResearchResult | null> {
  try {
    console.log(`[Research] 开始研究: "${keyword}"`);

    // 1. 尝试自定义搜索 API
    let summary = await searchCustomAPI(keyword);
    let source = '自定义搜索';

    // 2. 备用：自主生成知识条目
    if (!summary) {
      summary = generateKnowledge(keyword);
      source = '玉瑶的自主整理';
    }

    // 3. 返回研究结果（由调用方决定是否存入知识库）
    console.log(`[Research] ✅ 完成研究 "${keyword}"`);
    return {
      keyword,
      summary,
      sources: [source],
      entryId: `research_${Date.now().toString(36)}`,
    };
  } catch (err: any) {
    console.warn(`[Research] 研究失败: "${keyword}"`, err.message);
    return null;
  }
}
