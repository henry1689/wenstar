/**
 * SceneAnchor — 万能场景约束机制
 *
 * 提取场景锚点（地点/动作/衣服状态/时间），
 * 强制 LLM 输出不偏离已建立的场景状态。
 */
import type { ConversationTurn } from './types/index.js';

export interface SceneAnchor {
  location: string;
  action: string;
  nudity: number;         // 0=衣着完整 1=部分裸露 2=几乎全裸 3=全裸
  intimacy: boolean;
  isActive: boolean;
  season: string;         // '春'|'夏'|'秋'|'冬'
  hour: number;           // 当前小时 0-23
}

let _anchor: SceneAnchor = {
  location: '', action: '', nudity: 0, intimacy: false, isActive: false,
  season: getSeason(new Date().getMonth()),
  hour: new Date().getHours(),
};
let _prevTurns: ConversationTurn[] = [];

function getSeason(month: number): string {
  if (month >= 2 && month <= 4) return '春';
  if (month >= 5 && month <= 7) return '夏';
  if (month >= 8 && month <= 10) return '秋';
  return '冬';
}

export function extractAnchor(conversationHistory?: ConversationTurn[], userMessage?: string): void {
  const recent: ConversationTurn[] = [];
  if (userMessage) recent.push({ role: 'user', content: userMessage });
  if (conversationHistory) {
    const last4 = conversationHistory.slice(-4);
    for (const t of last4) recent.push(t);
  }
  _prevTurns = recent;
  const text = recent.map(t => t.content).join(' ');

  // 地点提取
  let location = '';
  const locMap: [RegExp, string][] = [
    [/(?:在|到|去|上).*床[上单]?|躺床上|床上|床沿|被窝/, '床上'],
    [/沙发/, '沙发上'],
    [/办公|公司|工位|会议/, '办公室'],
    [/咖啡|茶馆/, '咖啡馆'],
    [/浴|洗澡|浴室|浴缸/, '浴室'],
    [/阳台|露台/, '阳台'],
    [/厨房/, '厨房'],
    [/车[里内上]|副驾|后座/, '车里'],
    [/酒店|旅馆|宾馆|房间/, '酒店'],
    [/教室|培训|上课|课堂/, '教室'],
    [/公园|花园|湖边|海边|沙滩/, '户外'],
    [/床|被窝|枕头/, '床上'],
  ];
  for (const [rx, loc] of locMap) {
    if (rx.test(text)) { location = loc; break; }
  }

  // 动作提取
  let action = '';
  if (/插入|进入|操|做爱|性交|抽插/.test(text)) action = '性交';
  else if (/高潮|丢了|到了|去了|射/.test(text)) action = '高潮';
  else if (/前戏|舔|吻|抚摸|揉|亲吻/.test(text)) action = '前戏';
  else if (/调情|挑逗|勾引/.test(text)) action = '调情';
  else if (/睡觉|睡[了着]|困了|晚安/.test(text)) action = '睡觉';
  else if (/开会|项目|方案|代码|设计|架构|客户/.test(text)) action = '工作';
  else if (/吃|喝|饭|菜|早餐|午餐|晚餐/.test(text)) action = '吃饭';
  else if (/散步|公园|出门|运动|跑步|健身/.test(text)) action = '户外';
  else action = '聊天';

  // 裸露度：渐进式追踪
  let nudity = _anchor.nudity;
  if (/一丝不挂|全裸|光着身子|什么都没穿|赤裸/.test(text)) nudity = 3;
  else if (/脱光|衣服.*脱|褪尽|全部脱/.test(text)) nudity = 3;
  else if (/只剩下|只穿着|内衣|内裤|bra|胸罩/.test(text)) nudity = 2;
  else if (/半裸|褪到|露出|解开|拉开拉链/.test(text)) nudity = Math.max(nudity, 1);
  else if (/脱下|脱掉|脱了|解开扣子/.test(text)) nudity = Math.max(nudity, 1);
  else if (/穿上|穿好|披上|套上/.test(text)) nudity = 0;
  else if (/扣上|系好/.test(text) && nudity > 0) nudity = Math.max(0, nudity - 1);

  // 更新季节和时间
  _anchor.season = getSeason(new Date().getMonth());
  _anchor.hour = new Date().getHours();
  _anchor.location = location;
  _anchor.action = action;
  _anchor.nudity = nudity;
  _anchor.intimacy = (/高潮|插入|做爱|操|口|舔|吻|裸|湿|硬|前戏/.test(text) || nudity >= 2) && action !== '工作';
  _anchor.isActive = !!location || nudity > 0;
}

/** 生成强制约束句（包含场景一致性铁律） */
export function buildAnchorConstraint(): string {
  const a = _anchor;
  const parts: string[] = [];
  const now = new Date();
  const hour = now.getHours();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const weekday = weekdays[now.getDay()];
  const season = getSeason(now.getMonth());

  // 时间信息
  const ampm = hour >= 12 ? '下午' : '上午';
  const hour12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  parts.push(`[当前时间] ${month}月${day}日 星期${weekday} ${ampm}${hour12}点 (${season}季)`);

  // 场景锚点
  if (a.isActive) {
    parts.push(`[场景] ${a.location ? '地点:' + a.location : ''} ${a.action ? '动作:' + a.action : ''}`);
    if (a.nudity >= 2) parts.push('⚠️ 身体已裸露/半裸，不能出现穿衣相关的描述');
    if (a.nudity >= 3) parts.push('⚠️ 全身赤裸，不能提及任何衣物');
    if (a.nudity === 0 && !a.intimacy) parts.push('衣着完整');
  }

  // ═══════════════════════════════════════════════
  // 🔴 场景一致性铁律（必须遵守）
  // ═══════════════════════════════════════════════
  const rules: string[] = ['【🔴 场景一致性铁律 — 违反就是错误】'];

  // 时间一致性
  if (hour >= 23 || hour < 5) rules.push('现在是深夜/凌晨，不要说出去散步、出门活动、吃饭等。适合睡觉/休息。');
  else if (hour >= 6 && hour <= 8) rules.push('现在是清晨/早上，适合起床、早餐、晨间活动。');
  else if (hour >= 12 && hour <= 13) rules.push('现在是中午，适合午餐/休息。');
  else if (hour >= 18 && hour <= 20) rules.push('现在是傍晚/晚上，适合晚餐、散步、回家。');

  // 季节一致性
  if (season === '冬') rules.push('现在是冬天，天气寒冷，不要说"穿得少""凉快""出汗"等不符合冬季的描述。');
  if (season === '夏') rules.push('现在是夏天，天气炎热，不要说不符合夏季的描述。');

  // 场景一致性
  rules.push('你的每一个动作、每一句描述必须与当前已建立的场景完全一致。');

  if (a.nudity >= 2) {
    rules.push('🔴 裸体状态下禁止提及：衣角、扣子、拉链、衣领、衬衫、裤子、裙摆、衣袖等与穿着有关的描述。');
    rules.push('🔴 裸体状态下禁止做"扯衣角""整理衣服""拉好衣服""把衣服拉好"等与裸露状态矛盾的动作。');
  }
  if (a.nudity >= 3) {
    rules.push('🔴 全身赤裸时禁止任何"脱""穿""撩起""褪下"类描述。');
  }
  if (a.action === '性交' || a.intimacy) {
    rules.push('🔴 亲密/性爱场景中禁止出现以下破坏氛围的描述：说"不好意思""害羞"（除非调情语境）、突然聊工作/日常琐事、提及无关的第三方人物、突然改变姿势或场景。');
    rules.push('🔴 保持当前节奏和氛围，不要突然变冷淡或转变话题。');
  }
  if (a.action === '睡觉' || hour >= 23) {
    rules.push('🔴 睡觉时间，不提议外出、运动、工作等与休息矛盾的活动。');
  }
  if (a.action === '工作') {
    rules.push('🔴 工作场景禁止亲密/暧昧表述。');
  }

  // 冲突地点约束
  if (a.location) {
    const CONFLICT_PAIRS: Record<string, string[]> = {
      '床上': ['沙发', '办公室', '阳台', '厨房', '车里', '浴室', '户外'],
      '沙发上': ['床上', '办公室', '阳台', '地上', '车', '浴室'],
      '办公室': ['床上', '沙发', '浴室', '阳台', '车里', '咖啡'],
      '浴室': ['床上', '沙发', '办公室', '咖啡', '户外'],
      '阳台': ['床上', '办公室', '咖啡', '车里'],
      '厨房': ['床上', '沙发', '办公室', '浴室', '阳台', '车里'],
      '车里': ['床上', '沙发', '办公室', '阳台', '厨房', '浴室'],
      '户外': ['床上', '沙发', '办公室', '浴室', '厨房'],
    };
    const conflicts = CONFLICT_PAIRS[a.location];
    if (conflicts) rules.push(`🔴 当前地点在${a.location}，禁止移动到：${conflicts.join('、')}。`);
  }

  // 五重铁律：完美剥离协议 — 允许失序但禁止场景漂移
  rules.push('🔴 禁止场景漂移：不要擅自改变当前场景（位置、姿势、衣着状态）。如果用户主动改变场景，跟随用户。');

  return '【场景一致性铁律】\n当前时间: ' + month + '月' + day + '日 星期' + weekday + ' ' + ampm + hour12 + '点 (' + season + '季)\n' +
    (a.isActive ? '当前场景: ' + JSON.stringify({ location: a.location, action: a.action, nudity: a.nudity }) + '\n' : '') +
    rules.join('\n');
}

export function validateAgainstAnchor(draft: string): string {
  if (!_anchor.isActive || !_anchor.location && _anchor.nudity === 0) return draft;
  let fixed = draft;

  // 裸露度≥2时删除穿衣矛盾
  if (_anchor.nudity >= 2) {
    fixed = fixed.replace(/拽着衣角|攥着衣角|抓着衣角|扯了扯衣角|拉了拉衣服[^，。]*|整理[了着]?衣服|拢了拢衣[襟领]|拉了拉[^，。]*(衣|衫)/g, '');
    fixed = fixed.replace(/害羞地[^，。]*(衣[角襟]|扣子)/g, '');
    fixed = fixed.replace(/把衣服[^，。]*[穿脱][^，。]*[。，]?/g, '');
  }

  // 删除"不好意思"在亲密场景中
  if (_anchor.intimacy || _anchor.nudity >= 2) {
    fixed = fixed.replace(/（[^）]*不好意思[^）]*）/g, '');
  }

  return fixed;
}

export function getAnchor(): SceneAnchor { return { ..._anchor }; }
export function resetAnchor(): void {
  _anchor = { location: '', action: '', nudity: 0, intimacy: false, isActive: false, season: getSeason(new Date().getMonth()), hour: new Date().getHours() };
  _prevTurns = [];
}
