/**
 * ContextMemory — 跨轮上下文场景记忆
 *
 * 防止玉瑶出现前后矛盾的回复：
 * - 上一轮说"衣服褪到腰间"，下一轮就不能"害羞地拽衣角"
 * - 上一轮说"高潮了"，下一轮就不能"我还要"
 * - 上一轮说"在咖啡馆谈项目"，下一轮氛围不能变成"调情"
 *
 * 三个维度：
 *   ① 物理状态（衣着/姿势/位置/活动阶段）
 *   ② 氛围状态（情绪基调/张力/距离感）
 *   ③ 客观事实（发生过的关键事件）
 *
 * 用法:
 *   每次回复前后调用 updateAfterReply() / buildContextString()
 *   将 contextString 注入到 LLM 的 system prompt 中
 */

// ── 物理状态 ──
export interface PhysicalState {
  nudityLevel: number;       // 0=衣着完整 1=部分裸露 2=几乎全裸 3=全裸
  position: string;          // 坐着|躺着|站着|靠着|贴着|抱着
  location: string;          // 当前场景地点（床/沙发/阳台/咖啡馆/办公室…）
  activity: string;          // 聊天|调情|前戏|性交|后戏|日常|工作
}

// ── 氛围状态 ──
export interface AtmosphereState {
  mood: string;              // 平静|喜悦|悲伤|愤怒|兴奋|温存|紧张
  tension: number;           // 0=松弛 ~ 1=紧绷（情欲/冲突等）
  distance: number;          // 0=远（陌生）~ 1=零距离（亲密交融）
}

// ── 客观事实（最近几轮的关键事件） ──
export interface FactState {
  lastIntimatePeak: boolean; // 上一轮是否高潮
  lastUserTopic: string;     // 用户最后一轮的话题关键词
  lastReplyTone: string;     // 玉瑶上一轮的语调（warm/neutral/intimate/serious）
  mentionedEntities: string[]; // 最近提到的实体/人名
}

// ── 完整场景 ──
export interface ContextSnapshot {
  physical: PhysicalState;
  atmosphere: AtmosphereState;
  facts: FactState;
}

// ── 默认值 ──
const DEFAULT_SNAPSHOT: ContextSnapshot = {
  physical: { nudityLevel: 0, position: '坐着', location: '家里', activity: '聊天' },
  atmosphere: { mood: '平静', tension: 0.1, distance: 0.7 },
  facts: { lastIntimatePeak: false, lastUserTopic: '', lastReplyTone: 'warm', mentionedEntities: [] },
};

// ═══════════════════════════════════════════════════════════════
// 模块级状态（跨轮保持）
// ═══════════════════════════════════════════════════════════════

let _state: ContextSnapshot = { ...DEFAULT_SNAPSHOT, physical: { ...DEFAULT_SNAPSHOT.physical }, atmosphere: { ...DEFAULT_SNAPSHOT.atmosphere }, facts: { ...DEFAULT_SNAPSHOT.facts } };

/** 重置场景状态 */
export function resetContext(): void {
  _state = { ...DEFAULT_SNAPSHOT, physical: { ...DEFAULT_SNAPSHOT.physical }, atmosphere: { ...DEFAULT_SNAPSHOT.atmosphere }, facts: { ...DEFAULT_SNAPSHOT.facts } };
}

// ═══════════════════════════════════════════════════════════════
// 物理状态更新 — 从玉瑶的回复中提取
// ═══════════════════════════════════════════════════════════════

function updatePhysical(draft: string): void {
  // 衣着变化
  if (/脱掉|褪去|解开.*衣|脱.*光|一丝不挂|全裸|光着/.test(draft)) _state.physical.nudityLevel = 3;
  else if (/褪到腰间|露出|解开.*扣|半裸/.test(draft)) _state.physical.nudityLevel = 2;
  else if (/脱了外套|只穿着|撩起/.test(draft)) _state.physical.nudityLevel = 1;
  else if (/穿上|披上|套上|裹紧|整理.*衣/.test(draft) && !/没穿/.test(draft)) _state.physical.nudityLevel = Math.max(0, _state.physical.nudityLevel - 1);

  // 姿势变化
  if (/躺下|躺在床上|平躺/.test(draft)) _state.physical.position = '躺着';
  else if (/坐起|坐直/.test(draft)) _state.physical.position = '坐着';
  else if (/站起|站着|站起身来/.test(draft)) _state.physical.position = '站着';
  else if (/抱起|抱紧|贴在怀里/.test(draft) || (/抱/.test(draft) && /着/.test(draft))) _state.physical.position = '抱着';
  else if (/靠近|贴近|贴在你/.test(draft)) _state.physical.position = '贴着';

  // 地点变化（与 SceneAnchor.CONFLICT_PAIRS 的 key 保持对齐）
  if (/床/.test(draft)) _state.physical.location = '床上';
  else if (/沙发/.test(draft)) _state.physical.location = '沙发上';
  else if (/阳台/.test(draft)) _state.physical.location = '阳台';
  else if (/厨房|餐桌/.test(draft)) _state.physical.location = '厨房';
  else if (/浴室|洗澡|浴缸/.test(draft)) _state.physical.location = '浴室';
  else if (/酒店|旅馆|宾馆/.test(draft)) _state.physical.location = '酒店';
  else if (/办公|公司|工位/.test(draft)) _state.physical.location = '办公室';
  else if (/咖啡|咖啡馆/.test(draft)) _state.physical.location = '咖啡馆';
  else if (/车[里内上]/.test(draft)) _state.physical.location = '车里';
  else if (/教室|培训|上课/.test(draft)) _state.physical.location = '教室';

  // 活动变化
  if (/进去|插入|进入|操/.test(draft)) _state.physical.activity = '性交';
  else if (/高潮|丢了|去了|到了/.test(draft)) _state.physical.activity = '高潮';
  else if (/舔|吻|抚摸|揉|吸|前戏/.test(draft)) _state.physical.activity = '前戏';
  else if (/调情|挑逗|勾引/.test(draft)) _state.physical.activity = '调情';
  else if (/累|喘|瘫|软/.test(draft) && _state.physical.nudityLevel >= 2) _state.physical.activity = '后戏';
  else if (/提议|方案|项目|开会|代码|设计|架构/.test(draft)) _state.physical.activity = '工作';
}

// ═══════════════════════════════════════════════════════════════
// 氛围更新
// ═══════════════════════════════════════════════════════════════

function updateAtmosphere(draft: string, perception?: any): void {
  // 情绪基调
  if (/笑|开心|甜|暖|温柔/.test(draft)) _state.atmosphere.mood = '喜悦';
  else if (/哭|难过|伤心|痛/.test(draft)) _state.atmosphere.mood = '悲伤';
  else if (/怒|气|恨|烦/.test(draft)) _state.atmosphere.mood = '愤怒';
  else if (/激动|心跳|喘|要命|受不了/.test(draft)) _state.atmosphere.mood = '兴奋';
  else if (/想|爱|离不开|抱/.test(draft)) _state.atmosphere.mood = '温存';
  else if (/怕|紧张|不安/.test(draft)) _state.atmosphere.mood = '紧张';

  // 张力（从 perception 和文字共同推断）
  if (perception?.arousal > 0.6) _state.atmosphere.tension = Math.min(1, _state.atmosphere.tension + 0.2);
  else if (perception?.arousal < 0.2) _state.atmosphere.tension = Math.max(0, _state.atmosphere.tension - 0.1);
  if (/高潮|快要|不行了|受不了|要死了/.test(draft)) _state.atmosphere.tension = 1;
  if (/平静|放松|休息|累了/.test(draft)) _state.atmosphere.tension = Math.max(0, _state.atmosphere.tension - 0.3);

  // 距离
  if (/抱|贴|压|搂|缠|紧|深入/.test(draft)) _state.atmosphere.distance = Math.min(1, _state.atmosphere.distance + 0.15);
  else if (/远去|离开|放开|松开|起身/.test(draft)) _state.atmosphere.distance = Math.max(0, _state.atmosphere.distance - 0.2);
}

// ═══════════════════════════════════════════════════════════════
// 客观事实更新
// ═══════════════════════════════════════════════════════════════

function updateFacts(draft: string, userMessage: string, tone: string): void {
  _state.facts.lastIntimatePeak = /高潮|丢了|去了|到了/.test(draft);
  _state.facts.lastReplyTone = tone;
  _state.facts.lastUserTopic = userMessage.slice(0, 40);

  // 提取实体
  const entities = userMessage.match(/[一-龥]{2,3}(?=[，。？：；]|$)/g);
  if (entities) {
    _state.facts.mentionedEntities = [...new Set([..._state.facts.mentionedEntities, ...entities.map(e => e.trim())])].slice(-5);
  }
}

// ═══════════════════════════════════════════════════════════════
// 构建上下文提示（注入到 LLM 的 system prompt）
// ═══════════════════════════════════════════════════════════════

export function buildContextPrompt(): string {
  const p = _state.physical;
  const a = _state.atmosphere;
  const f = _state.facts;

  const parts: string[] = ['[当前场景]'];

  // 物理状态摘要
  const clothMap = ['衣着完整', '部分裸露', '几乎全裸', '全裸'];
  parts.push(`状态: ${clothMap[p.nudityLevel]}，${p.position}，在${p.location}，${p.activity}`);

  // 氛围摘要
  parts.push(`氛围: ${a.mood}，张力${a.tension.toFixed(1)}，距离感${a.distance.toFixed(1)}`);

  // 事实摘要（仅在有意义时输出）
  if (f.lastIntimatePeak) parts.push('⏺ 上一轮刚经历高潮');
  if (f.lastUserTopic) parts.push(`⏺ 用户刚才在说: ${f.lastUserTopic.slice(0, 30)}`);

  return parts.join(' | ') + '\n';
}

/** 获取当前快照（供外部读取/调试） */
export function getSceneSnapshot(): ContextSnapshot {
  return { ..._state, physical: { ..._state.physical }, atmosphere: { ..._state.atmosphere }, facts: { ..._state.facts } };
}

/** 手动设置场景（测试/重置用） */
export function setSceneSnapshot(s: Partial<ContextSnapshot>): void {
  if (s.physical) Object.assign(_state.physical, s.physical);
  if (s.atmosphere) Object.assign(_state.atmosphere, s.atmosphere);
  if (s.facts) Object.assign(_state.facts, s.facts);
}

/**
 * 更新记忆（由 M5 在每次回复后调用）
 */
export function updateAfterReply(draft: string, userMessage: string, tone: string, perception?: any): void {
  // 修复：从用户消息更新场景。原来只看 draft，不看 userMessage，
  // 用户说"这是在办公室"→updatePhysical 不知道→下一轮返回旧场景→LLM被误导
  if (userMessage && /办公|公司|工位|电脑|文件|打印|会议|开会/.test(userMessage) && !/家里|床|卧室|沙发/.test(userMessage)) {
    _state.physical.location = '办公室';
    _state.physical.activity = '工作';
    _state.physical.nudityLevel = 0;
    _state.physical.position = '坐着';
  }
  updatePhysical(draft);
  updateAtmosphere(draft, perception);
  updateFacts(draft, userMessage, tone);
}

// ═══════════════════════════════════════════════════════════════
// 场景一致性校验（同 HumanisticCalibrator 配合使用）
// ═══════════════════════════════════════════════════════════════

/**
 * 检查回复中是否有与当前场景矛盾的地方
 * 返回修正后的文本
 */
export function fixSceneConflict(draft: string, snapshot?: ContextSnapshot): string {
  const s = snapshot || _state;
  let fixed = draft;

  // 1. 全裸/几乎全裸时不能有"拽衣角""扣子"等动作
  if (s.physical.nudityLevel >= 2) {
    if (/衣角|衣领|扣子|拉链|整理.*衣/.test(fixed) && !/掀开|撩开|解开/.test(fixed)) {
      fixed = fixed.replace(/拽着衣角|攥着衣角|抓着衣角|害羞地.*?衣|不好意思.*?衣/g, '').trim();
    }
  }

  // 2. 前一秒高潮后不应马上说"我还要""再来"
  if (s.facts.lastIntimatePeak && /还要|再来|不够/.test(fixed) && !/不|别|累/.test(fixed)) {
    // 不直接删除，让自然表达
  }

  // 3. 工作场景由 SceneAnchor 管理，这里不再兜底

  return fixed || draft;
}
