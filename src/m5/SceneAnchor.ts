/**
 * SceneAnchor — 万能场景约束机制
 *
 * 从最近 2 轮对话提取核心锚点（地点/动作/状态），
 * 强制当前回复不允许偏离锚点、不允许出现锚点冲突的替代物。
 *
 * 流程:
 *   ① 提取锚点 ← 最近 2 轮对话
 *   ② 生成约束句 → 前置到 LLM 输出
 *   ③ 输出后校验 → 替换冲突词
 */
import type { ConversationTurn } from './types/index.js';

export interface SceneAnchor {
  location: string;       // "床上" | "沙发上" | "咖啡馆" | "办公室" | ...
  action: string;         // "性交" | "聊天" | "工作" | "吃饭" | ...
  nudity: number;         // 0-3
  intimacy: boolean;      // 是否亲密场景
  isActive: boolean;      // 是否有效（刚启动时无锚点则不约束）
}

let _anchor: SceneAnchor = { location: '', action: '', nudity: 0, intimacy: false, isActive: false };
let _prevTurns: ConversationTurn[] = [];

/** 无锚点时的冲突词对（可扩展，与 ContextMemory.updatePhysical 的地点保持对齐） */
const CONFLICT_PAIRS: Record<string, string[]> = {
  '床上': ['沙发', '办公室', '阳台', '厨房', '车里', '浴室'],
  '沙发上': ['床上', '办公室', '阳台', '地上', '车里'],
  '办公室': ['床上', '沙发上', '浴室', '阳台', '车里'],
  '咖啡馆': ['床上', '办公室', '浴室', '阳台', '车里', '家里'],
  '浴室': ['床上', '沙发上', '办公室', '咖啡馆', '车里'],
  '阳台': ['床上', '办公室', '咖啡馆', '车里'],
  '厨房': ['床上', '沙发上', '办公室', '浴室', '阳台', '车里'],
  '酒店': ['办公室', '阳台', '厨房', '浴室', '车里'],
  '车里': ['床上', '沙发上', '办公室', '阳台', '厨房', '浴室', '酒店'],
  '教室': ['床上', '沙发上', '浴室', '车里'],
};

/** 从最近 2 轮对话提取核心锚点 */
export function extractAnchor(conversationHistory?: ConversationTurn[], userMessage?: string): void {
  const recent: ConversationTurn[] = [];

  if (userMessage) recent.push({ role: 'user', content: userMessage });

  if (conversationHistory) {
    const last2 = conversationHistory.slice(-4); // 取 ≈2轮 (user+assistant算1轮)
    for (const t of last2) recent.push(t);
  }

  _prevTurns = recent;
  const text = recent.map(t => t.content).join(' ');

  // 提取地点
  let location = '';
  const locationMap: [RegExp, string][] = [
    [/(?:在|到|去|从|上).*(床[上单]?)/, '床上'],
    [/沙发/, '沙发上'],
    [/办公|公司|工位/, '办公室'],
    [/咖啡|咖啡馆/, '咖啡馆'],
    [/浴|洗澡|浴室/, '浴室'],
    [/阳台/, '阳台'],
    [/厨房/, '厨房'],
    [/车[里内上]/, '车里'],
    [/酒店|旅馆/, '酒店'],
    [/教室|培训|上课/, '教室'],
    [/床/, '床上'],
  ];
  for (const [rx, loc] of locationMap) {
    if (rx.test(text)) { location = loc; break; }
  }

  // 提取动作
  let action = '';
  if (/插入|进入|操|做爱|性交/.test(text)) action = '性交';
  else if (/高潮|丢了|到了|去了/.test(text)) action = '高潮';
  else if (/前戏|舔|吻|抚摸|揉/.test(text)) action = '前戏';
  else if (/调情|挑逗|勾引/.test(text)) action = '调情';
  else if (/开会|项目|方案|代码|设计|架构/.test(text)) action = '工作';
  else if (/吃|喝|饭|菜/.test(text)) action = '吃饭';
  else if (/散步|公园|出门|走/.test(text)) action = '户外';
  else action = '聊天';

  // 裸露度
  let nudity = 0;
  if (/一丝不挂|全裸|光着/.test(text)) nudity = 3;
  else if (/半裸|褪到|露出/.test(text)) nudity = 2;
  else if (/脱|裸/.test(text)) nudity = 1;

  // 亲密标志
  const intimacy = /高潮|插入|做爱|操|口|舔|吻|裸|湿|硬/.test(text) && action !== '工作';

  _anchor = { location, action, nudity, intimacy, isActive: !!location };
}

/** 生成强制约束句 */
export function buildAnchorConstraint(): string {
  if (!_anchor.isActive) return '';
  const a = _anchor;
  const parts: string[] = [`[场景锚点] 当前核心场景：${a.location}，`];

  if (a.action) parts.push(`正在${a.action}，`);
  if (a.nudity >= 2) parts.push('身体已裸露，');
  if (a.intimacy) parts.push('属于亲密场景，');

  parts.push('所有描述必须与当前场景直接相关。');
  if (a.location && CONFLICT_PAIRS[a.location]) {
    parts.push(`禁止出现: ${CONFLICT_PAIRS[a.location].join('、')}等替代场景。`);
  }
  if (a.nudity >= 2) {
    parts.push('不能出现"衣角""扣子""拉链"等与裸露状态矛盾的描述。');
  }

  return parts.join('');
}

/**
 * 输出后校验——检查回复中是否出现冲突词，替换为锚点对应正确词
 */
export function validateAgainstAnchor(draft: string): string {
  if (!_anchor.isActive || !_anchor.location) return draft;

  let fixed = draft;
  const conflicts = CONFLICT_PAIRS[_anchor.location];

  if (conflicts) {
    for (const conflict of conflicts) {
      if (fixed.includes(conflict)) {
        fixed = fixed.replace(new RegExp(conflict, 'g'), _anchor.location);
      }
    }
  }

  // 裸露度 ≥ 2 时，删除"拽着衣角"类矛盾描述
  if (_anchor.nudity >= 2) {
    fixed = fixed.replace(/拽着衣角|攥着衣角|抓着衣角|害羞地[^，。]*衣[^，。]*/g, '').trim();
  }

  return fixed;
}

/** 提取当前锚点（供调试） */
export function getAnchor(): SceneAnchor { return { ..._anchor }; }

/** 重置锚点 */
export function resetAnchor(): void {
  _anchor = { location: '', action: '', nudity: 0, intimacy: false, isActive: false };
  _prevTurns = [];
}
