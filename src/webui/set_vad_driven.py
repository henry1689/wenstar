"""Replace keyword-based tone calibration with VAD-value-driven approach in chat.ts"""
import re

PATH = "D:/wenstar/src/webui/chat.ts"

with open(PATH, "r", encoding="utf-8") as f:
    content = f.read()

# Step 1: Remove the old emotion score knowledge injection block
old_start = content.find(
    "// ═══════════════════════════════════════════════════════════════\n"
    "    // 情感谱曲引擎(8100)知识注入"
)
old_end = content.find(
    "    } catch (err) { console.warn('[EmotionScore] 谱曲引擎不可用(8100)，跳过注入:",
    old_start,
)
old_end = content.find("\n\n    // 线索协助", old_end)

new_vad_block = """    // ═══════════════════════════════════════════════════════════════
    // 情感谱曲引擎(8100)VAD驱动 — 用数值驱动 tone，而非关键词
    // ═══════════════════════════════════════════════════════════════
    try {
      // ① 获取 VAD 谱曲（当前消息的实时情感分析）
      const toneHint = await getVadToneHint(message);
      if (toneHint) console.log('[VADTone] toneHint: ' + toneHint.substring(0, 80));

      // ② 同时获取知识库曲谱清单（作为背景知识）
      let scoreText = '';
      const scoreResp = await fetch('http://localhost:8100/api/v1/emotion/knowledge/export?min_intensity=0.85');
      if (scoreResp.ok) {
        const scoreData = await scoreResp.json();
        const entries: Array<{ term: string; category: string; intensity: number; reversal: boolean }> = scoreData.entries || [];
        if (entries.length > 0) {
          const catLabels: Record<string, string> = { 'EX_': '极乐','FL_': '挑逗','IN_': '依恋','DO_': '掌控','TE_': '张力','AF_': '温存' };
          scoreText = '\\n【情感曲谱库】以下是你掌握的亲密表达知识（供参考）：\\n';
          const byCat: Record<string, typeof entries> = {};
          for (const e of entries) { const c = e.category || '??'; if (!byCat[c]) byCat[c] = []; byCat[c].push(e); }
          for (const [code, label] of Object.entries(catLabels)) {
            const es = byCat[code];
            if (!es?.length) continue;
            const terms = es.sort((a: any, b: any) => b.intensity - a.intensity).map((e: any) => '\\u300c' + e.term + '\\u300d').join(' ');
            scoreText += label + ': ' + terms + '\\n';
          }
          console.log('[EmotionScore] 已注入 ' + entries.length + ' 条情感曲谱');
        }
      }

      // ③ 整合 toneHint + scoreText -> knowledgeBaseText
      if (toneHint || scoreText) {
        const combined = (toneHint + '\\n\\n' + scoreText).trim();
        if (knowledgeBaseText) {
          knowledgeBaseText = combined + '\\n\\n' + knowledgeBaseText;
        } else {
          knowledgeBaseText = combined;
        }
      }
    } catch (err) { console.warn('[VADTone] 谱曲引擎(8100)不可用，跳过:', (err as Error).message); }"""

content = content[:old_start] + new_vad_block + content[old_end:]

# Step 2: Remove the keyword-based toneMap from DeepSeekLLMProvider.ts
# (we'll keep the contextBlock injection but make it check VAD knowledgeBaseText instead)
DSP_PATH = "D:/wenstar/src/m5/DeepSeekLLMProvider.ts"
with open(DSP_PATH, "r", encoding="utf-8") as f:
    dsp_content = f.read()

# Remove the whole toneMap section
tone_start = dsp_content.find("    // 🎯 情感谱曲 tone 校准")
tone_end = dsp_content.find("\n    // 软约束", tone_start)
# Actually let me find the exact section
if tone_start >= 0:
    tone_end = dsp_content.find("      console.log", tone_start)
    tone_end = dsp_content.find("\n", tone_end) + 1
    # Find the end of the tone map block - next emtpy line followed by a meaningful comment
    next_section = dsp_content.find("\n\n    // 表达规格约束", tone_start)
    if next_section < 0:
        next_section = dsp_content.find("\n\n    // 亲密场景", tone_start)
    if next_section < 0:
        next_section = dsp_content.find("\n\n    // 注入 M4", tone_start)

    if next_section > 0:
        dsp_content = dsp_content[:tone_start] + dsp_content[next_section:]
        with open(DSP_PATH, "w", encoding="utf-8") as f:
            f.write(dsp_content)
        print("✅ DeepSeekLLMProvider.ts toneMap 已移除")
else:
    print("⚠️ DeepSeekLLMProvider.ts 中未找到 tone 校准段，可能已被移除")

# Step 3: Add the getVadToneHint function to chat.ts (before processChat)
func_code = """
/** 获取 VAD 驱动的 tone 校准 — 调用 8100 谱曲引擎获取数值，用 V/A/dominant 决定 tone */
async function getVadToneHint(message: string): Promise<string> {
  try {
    const vadResp = await fetch('http://localhost:8100/api/v1/emotion/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
    if (!vadResp.ok) return '';
    const vadData = await vadResp.json();
    const v: number = vadData.overall?.valence ?? 0;
    const a: number = vadData.overall?.arousal ?? 0;
    const dom: string = vadData.overall?.dominant_emotion ?? '';
    const arc: string = vadData.overall?.emotional_arc ?? '';
    const peaks: Array<{ intensity: number; peak_type: string }> = vadData.peaks ?? [];
    const hasPeak = peaks.length > 0 && peaks[0].intensity > 0.7;

    const hints: string[] = [];

    // VAD 数值驱动 tone：不靠关键词，靠情感数值
    const emotionToTone: Record<string, string> = {
      '极乐': '🎯VAD驱动→【极乐】快感接近临界。用原始狂野的 tone 接住——不要温柔克制。',
      '依恋': '🎯VAD驱动→【依恋】情感底色是依恋和占有。用危险宠溺回应，不要悲伤害怕。',
      '掌控': '🎯VAD驱动→【掌控】权力游戏。用低沉命令的 tone 接住，不要温柔安慰。',
      '挑逗': '🎯VAD驱动→【挑逗】调情。用靠近低笑的 tone 接，不要当真严肃。',
      '温存': '🎯VAD驱动→【温存】求温暖。用温柔慵懒的 tone 回应。',
    };

    if (emotionToTone[dom]) {
      hints.push(emotionToTone[dom]);
    }

    // 数值增强
    if (v > 0.85 && a > 0.85) {
      hints.push('[VAD] 极高唤醒+效价→高潮临界表达。用极度热烈的 tone 回应。');
    } else if (v < -0.3 && (dom === '依恋' || dom === '掌控')) {
      hints.push('[VAD] 效价' + v.toFixed(2) + ',主导=' + dom + '→语义反转。用宠溺/掌控回应。');
    }

    if (hasPeak) {
      hints.push('[VAD] 情感峰值强度' + peaks[0].intensity.toFixed(2) + '→饱满情感浓度回应。');
    }

    if (arc && arc !== dom) {
      hints.push('[VAD] 情感弧线: ' + arc);
    }

    return hints.length > 0 ? hints.join('\\n') : '';
  } catch (err) {
    console.warn('[VADTone] 调用失败:', (err as Error).message);
    return '';
  }
}
"""

# Insert before processChat function
func_insert_point = content.find("export async function processChat")
if func_insert_point > 0:
    content = content[:func_insert_point] + func_code + content[func_insert_point:]
    print("✅ getVadToneHint 函数已插入 chat.ts")
else:
    print("⚠️ 未找到 processChat 函数插入点")

with open(PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("✅ chat.ts 已更新为 VAD 数值驱动模式")
