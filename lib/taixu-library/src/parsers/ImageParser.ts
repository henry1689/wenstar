/**
 * ImageParser — 图片 OCR 文件解析器
 *
 * 使用 tesseract.js 进行 OCR 文字识别。
 * 根据 OCR 结果 + 文件名进行情感/话题标签匹配。
 * OCR 失败时返回空内容，不崩溃。
 */

import { readFile } from 'node:fs/promises';
import type { ParsedResult, FileParser } from './ParserFactory.js';

interface SceneRule {
  keywords: string[];
  topic: string;
}

const SCENE_RULES: SceneRule[] = [
  { keywords: ['美食', '菜', 'food', 'dish', 'restaurant', 'cooking', 'cuisine', 'kitchen', 'eat', '用餐', '餐厅', '厨房'], topic: '美食' },
  { keywords: ['风景', '自然', 'landscape', 'scenery', 'nature', 'mountain', 'beach', 'ocean', 'sky', 'sunset', 'sunrise'], topic: '风景' },
  { keywords: ['工作', '会议', '办公', 'meeting', 'office', 'document', 'computer', 'presentation', 'workspace', '报告', '文件'], topic: '工作' },
  { keywords: ['人', '自拍', 'person', 'people', 'portrait', 'selfie', 'family', 'friend', 'group', 'party', '聚会', '朋友'], topic: '人物' },
  { keywords: ['宠物', '猫', '狗', 'pet', 'dog', 'cat', 'animal', 'cute', '宠物', '猫', '狗', '兔', '仓鼠'], topic: '宠物' },
  { keywords: ['旅行', '旅游', 'travel', 'trip', 'vacation', 'holiday', 'adventure', 'explore', '背包', '酒店', '机票'], topic: '旅行' },
  { keywords: ['建筑', 'architecture', 'building', 'city', 'urban', 'skyline', 'bridge', 'tower', '建筑', '城市', '桥'], topic: '建筑' },
  { keywords: ['植物', '花', 'plant', 'flower', 'garden', 'nature', 'tree', 'forest', '植物', '花园', '森林', '草'], topic: '自然' },
  { keywords: ['艺术', 'art', 'painting', 'drawing', 'creative', 'design', 'color', '艺术', '绘画', '设计', '创意'], topic: '艺术' },
  { keywords: ['科技', 'tech', 'technology', 'computer', 'digital', 'screen', 'code', 'programming', '科技', '电脑', '数码'], topic: '科技' },
  { keywords: ['运动', 'sport', 'fitness', 'gym', 'exercise', 'running', 'basketball', 'football', 'swim', '跑步', '健身', '游泳'], topic: '运动' },
  { keywords: ['音乐', 'music', 'concert', 'instrument', 'guitar', 'piano', '歌', '音乐', '演唱会', '乐器'], topic: '音乐' },
];

export class ImageParser implements FileParser {
  async parse(filePath: string): Promise<ParsedResult> {
    let ocrText = '';
    let confidence = 0;

    try {
      const Tesseract = await import('tesseract.js');
      const buffer = await readFile(filePath);

      const result = await Tesseract.recognize(
        buffer as any,
        'chi_sim+eng',
        undefined,
      );

      ocrText = result.data.text?.trim() || '';
      confidence = result.data.confidence ?? 0;
    } catch {
      // OCR failed—return empty result, don't crash
    }

    const fileName = filePath.replace(/.*[/\\]/, '');
    const tags = this.matchScenes(ocrText, fileName);

    return {
      content: ocrText,
      title: tags.length > 0 ? `[${tags[0]}] ${fileName}` : fileName,
      metadata: {
        tags: tags.join(','),
        ocrConfidence: String(confidence),
        ...(confidence < 50 && ocrText ? { warning: 'OCR置信度较低' } : {}),
      },
    };
  }

  private matchScenes(ocrText: string, fileName: string): string[] {
    const matched = new Set<string>();
    const lowerOcr = ocrText.toLowerCase();
    const lowerName = fileName.toLowerCase();

    for (const rule of SCENE_RULES) {
      const hasKeyword = rule.keywords.some(kw =>
        lowerOcr.includes(kw) || lowerName.includes(kw),
      );
      if (hasKeyword) {
        matched.add(rule.topic);
      }
    }

    return [...matched];
  }
}
