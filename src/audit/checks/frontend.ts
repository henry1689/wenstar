/** 前端交互审计（7项）— 标记为 manual 需要人工确认 */
import type { CheckResult } from '../types.js';
import { manual } from '../helpers.js';

const MODULE = 'frontend' as const;

export async function checkFrontendAll(): Promise<CheckResult[]> {
  return [
    manual('frontend_25', 'SSE流式对话', MODULE, '打开网页发消息，观察回复是否逐字输出'),
    manual('frontend_26', '历史对话加载', MODULE, '刷新页面，检查上一轮对话是否保留'),
    manual('frontend_27', '30秒消息撤回', MODULE, '发消息后30秒内点击撤回按钮'),
    manual('frontend_28', 'TTS语音播报', MODULE, '点击喇叭按钮切换音色，听是否发音'),
    manual('frontend_29', '操作结果反馈', MODULE, '上传文件，看是否有绿色/红色提示条'),
    manual('frontend_30', '设置面板', MODULE, '点击齿轮按钮，检查API Key/TTS设置是否正常'),
    manual('frontend_31', '自然语言记事', MODULE, '说"帮我记住测试"，再问能否答出'),
  ];
}
