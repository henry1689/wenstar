/**
 * ClaudeLLMProvider — 灵肉伴侣真实 LLM 实现
 *
 * @deprecated 当前使用 DeepSeekLLMProvider。保留作为备选切换。
 *
 * 使用 Anthropic Claude API，注入灵肉伴侣人设。
 * 当 API_KEY 未设置时回退到 MockLLMProvider。
 *
 * 核心: 每次调用的 System Prompt 包含:
 *   1. 核心人设 (CORE_PERSONA) — 永久不变
 *   2. 5级等级指示 (buildLevelInstruction) — 动态适配
 *   3. 当前上下文 (历史记忆/感知维度/场景)
 *
 * 环境变量:
 *   ANTHROPIC_API_KEY — 你的 Claude API Key
 *   ANTHROPIC_MODEL — 模型名，默认 claude-sonnet-4-6
 */
import type { LLMProvider, StrategyConfig, CognitionObject } from './types/index.js';
import { buildSystemPrompt, CORE_PERSONA, STYLE_ANCHORS } from './persona/lover-persona.js';
import { calcLevel } from './expression/TierVocabMap.js';

const API_KEY = process.env['ANTHROPIC_API_KEY'];
const MODEL = process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-6-20251001';

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeResponse {
  content: Array<{ text: string }>;
}

/**
 * 检测是否可用
 */
export function isAvailable(): boolean {
  return !!API_KEY;
}

export class ClaudeLLMProvider implements LLMProvider {
  private model: string;

  constructor(model?: string) {
    this.model = model ?? MODEL;
  }

  async generate(params: {
    strategy: StrategyConfig;
    cognition: CognitionObject;
  }): Promise<{ text: string }> {
    const s = params.cognition.current.perception_snapshot;
    const rawInput = params.cognition.current.raw_input ?? '';
    const entities = params.cognition.current.key_entities ?? [];
    const hasHistory = params.cognition.history.has_relevant_history;
    const historySummary = params.cognition.history.summary;
    const familyCtx = params.cognition.family?.relationships ?? [];

    // 计算话术等级
    const bp = calcLevel(
      s.pleasure, s.intimacy, s.sexual_attraction, s.sensory_craving,
      s.energy_merge, s.possessiveness, s.ecstasy, s.arousal,
      s.aggression, s.sincerity, s.dominance, rawInput,
    );
    const level = bp.level;

    // 构建 System Prompt
    const systemPrompt = buildSystemPrompt(level);

    // 构建上下文
    const dimContext = [
      `pleasure=${s.pleasure.toFixed(1)}`,
      `intimacy=${s.intimacy.toFixed(1)}`,
      `sexual_attraction=${s.sexual_attraction.toFixed(1)}`,
      `sensory_craving=${s.sensory_craving.toFixed(1)}`,
      `energy_merge=${s.energy_merge.toFixed(1)}`,
      `intensity_raw=${bp.raw.toFixed(2)}`,
    ].join(' ');

    let contextBlock = `[感知维度: ${dimContext}]`;
    if (hasHistory && historySummary) {
      contextBlock += `\n[相关记忆: ${historySummary.substring(0, 200)}]`;
    }
    if (familyCtx.length > 0) {
      contextBlock += `\n[人物关系: ${familyCtx.join('; ')}]`;
    }

    // 风格参考
    const goodExample = STYLE_ANCHORS.good[Math.floor(Math.random() * STYLE_ANCHORS.good.length)];
    contextBlock += `\n[风格参考: "${goodExample}"]`;

    // 构建 messages
    const messages: ClaudeMessage[] = [
      {
        role: 'user',
        content: `${contextBlock}\n\n鸿鸣对你说: ${rawInput}`,
      },
    ];

    // 调用 Claude API
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: level >= 2 ? 600 : 200,
          system: systemPrompt,
          messages,
          temperature: level >= 2 ? 0.9 : 0.7,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Claude API ${response.status}: ${errText.substring(0, 200)}`);
      }

      const data = (await response.json()) as ClaudeResponse;
      const text = data.content?.[0]?.text?.trim() ?? '';

      if (!text) throw new Error('Empty response from Claude');

      return { text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ClaudeLLMProvider] Error: ${msg}`);
      // 降级到基础回应
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
