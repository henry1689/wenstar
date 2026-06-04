/**
 * TaskPlanner — 自然语言 → 结构化任务计划
 *
 * 基于规则的关键词匹配，不依赖 LLM。
 * 解析常见办公场景的指令模式。
 */

import type { TaskPlan, TaskStep } from './types.js';

/** 时间表达式解析：将自然语言时间转为 ISO 字符串 */
function parseTime(text: string): { time?: string; note: string } {
  const now = new Date();
  let time: string | undefined;

  // 明天
  if (/明天/.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    const match = text.match(/(\d+)[:：]?(\d*)\s*(点|时)/);
    if (match) {
      d.setHours(parseInt(match[1]), parseInt(match[2] || '0'), 0, 0);
      time = d.toISOString();
    } else {
      d.setHours(9, 0, 0, 0);
      time = d.toISOString();
    }
    return { time, note: '' };
  }

  // 本周X / 周X
  const dayMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
  for (const [cn, num] of Object.entries(dayMap)) {
    if (new RegExp(`周${cn}|星期${cn}`).test(text)) {
      const d = new Date(now);
      const currentDay = d.getDay() || 7;
      let diff = num - currentDay;
      if (diff <= 0) diff += 7;
      d.setDate(d.getDate() + diff);
      const match = text.match(/(\d+)[:：]?(\d*)\s*(点|时)/);
      if (match) {
        d.setHours(parseInt(match[1]), parseInt(match[2] || '0'), 0, 0);
      } else {
        d.setHours(9, 0, 0, 0);
      }
      time = d.toISOString();
      return { time, note: '' };
    }
  }

  // 今天/现在
  if (/今天|现在/.test(text)) {
    const match = text.match(/(\d+)[:：]?(\d*)\s*(点|时)/);
    if (match) {
      const d = new Date(now);
      d.setHours(parseInt(match[1]), parseInt(match[2] || '0'), 0, 0);
      time = d.toISOString();
      return { time, note: '' };
    }
  }

  // 下午X点
  const pmMatch = text.match(/下午\s*(\d+)[:：]?(\d*)\s*(点|时)/);
  if (pmMatch) {
    const d = new Date(now);
    d.setHours(parseInt(pmMatch[1]) + 12, parseInt(pmMatch[2] || '0'), 0, 0);
    time = d.toISOString();
    return { time, note: '' };
  }

  return { time, note: '' };
}

/** 解析"提醒我"类指令 */
function parseReminder(text: string): { steps: TaskStep[] } | null {
  const remindMatch = text.match(/提醒\s*(?:我)?\s*(.+?)(?:在|于|$)/);
  if (!remindMatch) return null;

  const content = remindMatch[1];
  const { time } = parseTime(text);
  const textParts = text.replace(/提醒.*$/, '').replace(/请|帮|我|一下/g, '').trim();

  const steps: TaskStep[] = [];

  if (time) {
    steps.push({
      tool: 'reminder',
      action: 'set',
      params: { text: content || textParts || '提醒事项', time },
    });
  } else {
    // 没有明确时间，设一个默认提醒（1小时后）
    const d = new Date(Date.now() + 3600000);
    steps.push({
      tool: 'reminder',
      action: 'set',
      params: { text: content || textParts || '提醒事项', time: d.toISOString() },
    });
  }

  return { steps };
}

/** 解析"记/写/记录"类指令 */
function parseNote(text: string): { steps: TaskStep[] } | null {
  const noteMatch = text.match(/记(?:录)?[：:]\s*(.+)/);
  if (!noteMatch) return null;

  const content = noteMatch[1];
  const titleMatch = text.match(/记(?:录)?[：:]\s*([^\s，。、]+)/);

  return {
    steps: [{
      tool: 'note',
      action: 'create',
      params: { title: titleMatch?.[1] || '快速记录', content },
    }],
  };
}

/** 解析"约/安排/创建日程"类指令 */
function parseCalendar(text: string): { steps: TaskStep[] } | null {
  if (!/(约|安排|创建|添加|计划)/.test(text)) return null;

  const titleMatch = text.replace(/请|帮|我|一下|约|安排|创建|添加|计划/g, '').trim();
  const { time } = parseTime(text);

  if (!titleMatch || !time) return null;

  // 检查是否同时有"提醒"关键词
  const steps: TaskStep[] = [];

  steps.push({
    tool: 'calendar',
    action: 'create',
    params: { title: titleMatch, time },
  });

  if (/提醒/.test(text)) {
    const remindTime = new Date(new Date(time).getTime() - 30 * 60000);
    steps.push({
      tool: 'reminder',
      action: 'set',
      params: { text: `📅 ${titleMatch}`, time: remindTime.toISOString() },
    });
  }

  return { steps };
}

/** 主入口：解析用户自然语言指令 */
export function plan(text: string): TaskPlan | null {
  // 1. 日历类
  const calPlan = parseCalendar(text);
  if (calPlan) {
    return { summary: `安排日程: ${text}`, steps: calPlan.steps };
  }

  // 2. 提醒类
  const remindPlan = parseReminder(text);
  if (remindPlan) {
    return { summary: `设置提醒: ${text}`, steps: remindPlan.steps };
  }

  // 3. 笔记类
  const notePlan = parseNote(text);
  if (notePlan) {
    return { summary: `记录笔记: ${text}`, steps: notePlan.steps };
  }

  // 无法解析
  return null;
}
