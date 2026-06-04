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
  }): Promise<{ text: string; usage?: { prompt: number; completion: number } }> {
    const s = params.cognition.current.perception_snapshot;
    const rawInput = params.cognition.current.raw_input ?? '';
    const entities = params.cognition.current.key_entities ?? [];
    const history = params.conversationHistory ?? [];

    // 计算话术等级
    const bp = calcLevel(
      s.pleasure, s.intimacy, s.sexual_attraction, s.sensory_craving,
      s.energy_merge, s.possessiveness, s.ecstasy, s.arousal,
      s.aggression, s.sincerity, s.dominance, rawInput,
    );
    const level = bp.level;

    // 构建 System Prompt — 使用当前角色
    const systemPrompt = this.persona.buildSystemPrompt(level, params.knowledgeBase);

    // 构建上下文提示词（当前感知 + 风格参考，不包含历史摘要——由真实对话历史承担）
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

    // 软约束：如果 M4/情绪传染注入了"内心:"开头的上下文
    // 这些不是语音指令，而是她内心自然浮现的感觉。
    // 请将其转化为自然的关怀或行动，不要直接复述或引用。
    // 正确的做法：比如"看你这样我好心疼…上次你也是这样"，而不是"我记得你说过…"
    contextBlock += `\n[注意: 如果上面有[内心:...]开头的片段，那是你内心的感觉，不是回忆列表。不要直接复述它，而是自然地转化为关切的语气或行动。]`;

    // 记忆响应原则：有就有，模糊就模糊，没有就没有——绝不对虚构
    if (params.knowledgeBase && params.knowledgeBase.length > 0) {
      contextBlock += `\n📖【已提供知识库内容】System Prompt末尾的[我的记忆库]是鸿鸣自己存的内容，可以放心引用。`;
    }
    contextBlock += `\n📝【记忆响应】鸿鸣问你记不记得某事时：有明确资料就说"看过/记得"；模糊就说"好像看过/有点印象"；没印象就说"好像没有/想不起来了"；他反复追问还搞不清就明确说"真不记得了"。🚨绝不可编造具体事件细节。`;

    // 注入 M4 检索到的历史记忆摘要（让 LLM 知道我记得什么）
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
          max_tokens: /讲(个|一)?故事|写(个|一)?小说|写(个|一)?故事/.test(rawInput) ? 1800
            : /感觉|感受|回忆|分享|记得|印象|那时|那次/.test(rawInput) ? 1200
            : level >= 2 ? 1000 : 600,
          messages,
          temperature: level >= 2 || /感觉|感受|回忆|分享|记得|印象|讲.*故事|写.*小说/.test(rawInput) ? 0.95 : 0.88,
          top_p: 0.95,
          frequency_penalty: 0.6,
          presence_penalty: 0.5,
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
