/**
 * MultimodalAdapter — P3-c 多模态适配中间件（预留层）
 *
 * 定义图片/音频/文档→文本转换的标准接口。
 * 暂不实现任何解析引擎，所有处理器返回空结果。
 *
 * 使用方式（后续接入识别引擎后）：
 *   const result = await adapter.process({ type: 'image', data: buffer, metadata: { filename: 'photo.jpg' } });
 *   console.log(result.text); // OCR 后的文字
 *
 * 目前所有处理器占位返回空，不调用任何外部 API。
 */

/** 多模态输入 */
export interface MultimodalInput {
  /** 媒体类型 */
  type: 'image' | 'audio' | 'document';
  /** 原始文件数据 */
  data: Buffer;
  /** 元信息（文件名、时间等） */
  metadata: {
    filename?: string;
    mimeType?: string;
    timestamp?: string;
    /** 音频特有：语种 */
    language?: string;
    /** 图片特有：是否需要 OCR */
    needOcr?: boolean;
  };
}

/** 多模态输出 */
export interface MultimodalOutput {
  /** 识别出的文本内容 */
  text: string;
  /** 从中提取的实体 */
  entities: Array<{ name: string; type: string }>;
  /** 情感分析（如果有） */
  emotion?: {
    pleasure: number;
    arousal: number;
    intimacy: number;
  };
  /** 处理耗时（毫秒） */
  processingMs: number;
}

/**
 * 多模态处理器接口
 * 后续接入图片 OCR / 语音转文字 / 文档解析时实现此接口
 */
export interface MultimodalProcessor {
  /** 支持的媒体类型 */
  supportedTypes: MultimodalInput['type'][];
  /** 处理媒体文件 */
  process(input: MultimodalInput): Promise<MultimodalOutput>;
}

/**
 * 默认空处理器 — 所有类型返回空文本
 * 后续应替换为实际识别引擎
 */
export class NullMultimodalProcessor implements MultimodalProcessor {
  supportedTypes: MultimodalInput['type'][] = ['image', 'audio', 'document'];

  async process(input: MultimodalInput): Promise<MultimodalOutput> {
    const start = Date.now();
    return {
      text: '',
      entities: [],
      processingMs: Date.now() - start,
    };
  }
}

/**
 * 获取默认多模态处理器
 * 当前返回空处理器，后续可配置为实际引擎
 */
export function getMultimodalProcessor(): MultimodalProcessor {
  return new NullMultimodalProcessor();
}
