/**
 * DeepSeekLLMProvider — 玉瑶 · 太虚境 LLM 驱动
 *
 * 使用 DeepSeek V4 API（兼容 OpenAI 格式），注入灵肉伴侣人设。
 * 支持对话历史注入，让模型拥有真实的对话连续性记忆。
 *
 * 环境变量:
 *   DEEPSEEK_API_KEY — 你的 DeepSeek API Key
 *   DEEPSEEK_MODEL — 模型名，默认 deepseek-chat
 */
import type { LLMProvider, StrategyConfig, CognitionObject, ConversationTurn } from './types/index.js';
import { buildSystemPrompt, STYLE_ANCHORS } from './persona/lover-persona.js';
import { calcLevel } from './expression/TierVocabMap.js';
import { calcExpressionSpec } from './expression/ExpressionSpecController.js';
import { renderIntimateResponse } from './expression/IntimateRenderer.js';
import type { IntimateSceneType } from './expression/IntimateRenderer.js';
import type { IPersona } from '../app/persona/types.js';
import { getKeyValue } from '../app/shared/ApiKeyStorage.js';

const API_KEY = process.env['DEEPSEEK_API_KEY'];

if (!API_KEY) {
  console.warn('[DeepSeekLLMProvider] 警告: 未设置 DEEPSEEK_API_KEY 环境变量，将使用降级回复');
}

const MODEL = process.env['DEEPSEEK_MODEL'] ?? 'deepseek-chat';
const BASE_URL = 'https://api.deepseek.com/v1';
const MAX_HISTORY_TURNS = 200; // 保留最近 100 轮完整对话

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepSeekResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** 运行时获取 API Key（优先环境变量，其次运行时存储） */
function resolveApiKey(): string | undefined {
  return process.env['DEEPSEEK_API_KEY'] || getKeyValue('DEEPSEEK_API_KEY') || undefined;
}

export function isAvailable(): boolean {
  return !!(process.env['DEEPSEEK_API_KEY'] || getKeyValue('DEEPSEEK_API_KEY'));
}

export class DeepSeekLLMProvider implements LLMProvider {
  private model: string;
  private persona: IPersona;

  constructor(model?: string, persona?: IPersona) {
    this.model = model ?? MODEL;
    // 默认玉瑶人设
    this.persona = persona ?? {
      id: 'yuyao',
      name: '玉瑶 · 灵魂伴侣',
      description: '默认',
      buildSystemPrompt: (l, k) => buildSystemPrompt(l, k),
    };
  }

  /** 切换角色 */
  setPersona(persona: IPersona): void {
    this.persona = persona;
  }

  async generate(params: {
    strategy: StrategyConfig;
    cognition: CognitionObject;
    conversationHistory?: ConversationTurn[];
    knowledgeBase?: string;
    currentTime?: string;
  }): Promise<{ text: string; usage?: { prompt: number; completion: number } }> {
    const rawInput = params.cognition.current.raw_input ?? '';
    const history = params.conversationHistory ?? [];
    const kb = params.knowledgeBase ?? '';

    // 🔥 角色扮演：完全隔离路径
    if (kb.startsWith('【角色扮演】')) {
      const rpContent = kb.replace('【角色扮演】', '').trim();
      const messages: DeepSeekMessage[] = [{ role: 'system', content: rpContent }];
      // 带记忆消息 + 最近历史（但净化"妙玉"等触发词）
      const memoryMsg = history.find(t => t.content?.startsWith('📕 【记忆】'));
      if (memoryMsg) messages.push({ role: 'user', content: memoryMsg.content });
      const sanitize = (t: string) => t.replaceAll('妙玉', '玉儿').replaceAll('宝玉', '宝二爷').replaceAll('红楼逸事', '桃花源记');
      for (const turn of history.slice(-4)) {
        if (turn.content?.startsWith('📕 【记忆】')) continue;
        messages.push({ role: turn.role, content: sanitize(turn.content) });
      }
      messages.push({ role: 'user', content: sanitize(rawInput) });
      try {
        const r = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resolveApiKey() || API_KEY}` },
          body: JSON.stringify({
            model: this.model, max_tokens: 1500, messages,
            temperature: 0.95, top_p: 0.9, frequency_penalty: 0.1, presence_penalty: 0.5,
          }),
        });
        if (!r.ok) throw new Error(`DeepSeek API ${r.status}: ${(await r.text()).substring(0,200)}`);
        const data = (await r.json()) as DeepSeekResponse;
        const text = data.choices?.[0]?.message?.content?.trim() ?? '';
        if (!text) throw new Error('Empty');
        return { text, usage: data.usage ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens } : undefined };
      } catch (err) {
        console.error('[Roleplay]', err instanceof Error ? err.message : err);
        return { text: '…' };
      }
    }

    // ── 正常玉瑶模式 ──
    const s = params.cognition.current.perception_snapshot;
    const entities = params.cognition.current.key_entities ?? [];

    // 计算话术等级
    const bp = calcLevel(
      s.pleasure, s.intimacy, s.sexual_attraction, s.sensory_craving,
      s.energy_merge, s.possessiveness, s.ecstasy, s.arousal,
      s.aggression, s.sincerity, s.dominance, rawInput,
    );
    const level = bp.level;

    // ── 表达规格控制（ExpressionSpecController 激活） ──
    const spec = calcExpressionSpec({
      pleasure: s.pleasure, arousal: s.arousal, intimacy: s.intimacy,
      sexual_attraction: s.sexual_attraction, sensory_craving: s.sensory_craving,
      energy_merge: s.energy_merge, ecstasy: s.ecstasy, safety: s.safety,
    });

    // ── 亲密场景渲染（IntimateRenderer 激活 — level ≥ 2 时注入 few-shot） ──
    let intimateSceneExample = '';
    if (level >= 2 && !kb.startsWith('【角色扮演】')) {
      try {
        const sceneTypes: IntimateSceneType[] = ['foreplay', 'thrust', 'climax', 'aftercare'];
        const sceneType = sceneTypes[Math.floor(Math.random() * sceneTypes.length)];
        intimateSceneExample = renderIntimateResponse({
          intensity: bp.raw,
          sceneType,
          userLevel: level >= 2 ? 3 : 2,
        });
      } catch (err) {
        console.warn('[IntimateRenderer] 渲染失败:', err);
      }
    }

    // 构建 System Prompt — 使用当前角色
    // 注入当前系统时间（Asia/Shanghai）
    const timeStr = params.currentTime
      ? new Date(params.currentTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
      : new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

    const systemPrompt = `当前系统时间（北京时间）: ${timeStr}\n\n${this.persona.buildSystemPrompt(level, params.knowledgeBase)}`;

    // 构建上下文提示词
    const dimContext = [
      `pleasure=${s.pleasure.toFixed(2)}`,
      `intimacy=${s.intimacy.toFixed(2)}`,
      `sexual_attraction=${s.sexual_attraction.toFixed(2)}`,
      `sensory_craving=${s.sensory_craving.toFixed(2)}`,
      `energy_merge=${s.energy_merge.toFixed(2)}`,
      `intensity_raw=${bp.raw.toFixed(2)}`,
    ].join(' ');

    const goodExample = STYLE_ANCHORS.good[Math.floor(Math.random() * STYLE_ANCHORS.good.length)];
    let contextBlock = `[当前感知: ${dimContext}]\n[风格参考: "${goodExample}"]`;

    if (entities.length > 0) {
      contextBlock += `\n[提到: ${entities.join(', ')}]`;
    }

    // 表达规格约束
    if (spec.forbiddenPatterns.length > 0) {
      contextBlock += `\n[避免] "${spec.forbiddenPatterns.join('", "')}" 这类回应`;
    }
    if (spec.requireEmbodiedResponse) {
      contextBlock += `\n[要求] 包含身体反应描写（体温/呼吸/心跳）`;
    }
    if (spec.requireSensoryDetail) {
      contextBlock += `\n[要求] 包含感官细节（触觉/嗅觉/听觉）`;
    }
    if (spec.recommendedPhrases.length > 0) {
      contextBlock += `\n[推荐维度] ${spec.recommendedPhrases.join(', ')}`;
    }

    // 亲密场景 few-shot 注入
    if (intimateSceneExample) {
      contextBlock += `\n[亲密回应示例] ${intimateSceneExample}`;
    }

    // 软约束
    contextBlock += `\n[注意: 如果上面有[内心:...]开头的片段，那是你内心的感觉，不是回忆列表。不要直接复述它，而是自然地转化为关切的语气或行动。]`;



    // 注入 M4 检索到的历史记忆摘要
    const hist = params.cognition.history;
    if (hist?.has_relevant_history && hist.summary !== '无相关历史记忆') {
      contextBlock += `\n[记忆: ${hist.summary}]\n[标签说明: [粉末]=不重要 [液体]=普通 [固体]=重要 [晶体]=刻骨铭心。根据强度标签在回复中自然地体现这些记忆的轻重分量。]\n⚠️ 你只能引用上面[记忆:]中写到的内容。没有写在里面的过去事件、对话、场景，你一概不知道。绝不能编造。`;
    }
    // 注入家族关系
    const fam = params.cognition.family;
    if (fam?.has_family_context && fam.relationships.length > 0) {
      contextBlock += `\n[家族: ${fam.relationships.join('; ')}]`;
    }

    // ═══ 构建聊天消息流 ═══
    const messages: DeepSeekMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    // 🚨 身份边界隔离墙：在对话历史前注入，防止LLM把鸿鸣说的事当成自己的事
    messages.push({
      role: 'system',
      content: `【身份边界提醒】下面对话中"鸿鸣"说的所有话都是他的事。他说"我在做XXX"是他的工作和生活，你只是陪伴他的伴侣，没有这些经历。你不知道自己具体在忙什么，不要编造工作内容。`,
    });

    // 注入最近对话历史（作为真实的 user/assistant 消息）
    // 取最近 MAX_HISTORY_TURNS 条，保持 user/assistant 交替顺序
    const recentTurns = history.slice(-MAX_HISTORY_TURNS);
    for (const turn of recentTurns) {
      messages.push({ role: turn.role, content: turn.content });
    }

    // 当前用户消息（带上下文）
    const currentMsg = `${contextBlock}\n\n鸿鸣: ${rawInput}`;
    messages.push({ role: 'user', content: currentMsg });

    // 调用 DeepSeek API
    try {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resolveApiKey() || API_KEY}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: Math.max(
            /讲(个|一)?故事|写(个|一)?小说|写(个|一)?故事/.test(rawInput) ? 1800
            : /感觉|感受|回忆|分享|记得|印象|那时|那次/.test(rawInput) ? 1500
            : level >= 2 ? 1200 : 800,
            spec.wordCountMin, // ExpressionSpec 兜底：确保最少字数
          ),
          messages,
          temperature: level >= 2 || /感觉|感受|回忆|分享|记得|印象|讲.*故事|写.*小说/.test(rawInput) ? 1.0 : 0.9,
          top_p: 0.95,
          frequency_penalty: level >= 2 ? 0.0 : 0.3,
          presence_penalty: level >= 2 ? 0.2 : 0.4,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`DeepSeek API ${response.status}: ${errText.substring(0, 200)}`);
      }

      const data = (await response.json()) as DeepSeekResponse;
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';

      if (!text) throw new Error('Empty response from DeepSeek');

      return {
        text,
        usage: data.usage
          ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens }
          : undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DeepSeekLLMProvider] Error: ${msg}`);
      return { text: fallbackReply(level) };
    }
  }
}

function fallbackReply(level: number): string {
  const pool: Record<number, string[]> = {
    '-2': ['嗯。', '好。', '随便你。'],
    '-1': ['…算了。', '嗯，没事。', '我知道了。'],
    '0': ['嗯～好的呀。', '好嘞～', '行，听你的。'],
    '1': ['嗯…我想你了。', '你一说这个我就想抱抱你了。', '真是的～你这个人。'],
    '2': ['（呼吸乱了）你…你真是要人命。', '我脑子全是那些画面…想停都停不下来。'],
  };
  const p = pool[level] ?? pool[0];
  return p[Math.floor(Math.random() * p.length)];
}
