/**
 * ReminderTool — 提醒管理
 * 内存存储 + JSON 文件持久化 + 定时触发
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ITool, Reminder } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_FILE = join(__dirname, '..', '..', '..', '..', 'data', 'webui', 'reminders.json');

function loadReminders(): Reminder[] {
  try {
    if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch (err) { console.warn("[Reminder] 加载失败:", err); }
  return [];
}

function saveReminders(reminders: Reminder[]): void {
  const dir = dirname(DATA_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(reminders, null, 2), 'utf-8');
}

export const reminderTool: ITool = {
  name: 'reminder',
  description: '提醒管理：设置/取消/列出提醒',

  async execute(action: string, params: Record<string, any>): Promise<string> {
    const reminders = loadReminders();

    switch (action) {
      case 'set': {
        const reminder: Reminder = {
          id: `rm_${Date.now().toString(36)}`,
          text: params.text || '提醒',
          fireAt: params.time || new Date(Date.now() + 3600000).toISOString(),
          fired: false,
          created_at: new Date().toISOString(),
        };
        reminders.push(reminder);
        saveReminders(reminders);
        return `⏰ 已设置提醒: "${reminder.text}" 于 ${reminder.fireAt.substring(0, 16)}`;
      }

      case 'list': {
        const active = reminders.filter(r => !r.fired).slice(0, 10);
        if (active.length === 0) return '暂无待触发提醒';
        return active.map(r =>
          `⏰ ${r.fireAt.substring(0, 16)} — ${r.text}`
        ).join('\n');
      }

      case 'cancel': {
        const idx = reminders.findIndex(r => r.id === params.id);
        if (idx < 0) return '未找到该提醒';
        reminders.splice(idx, 1);
        saveReminders(reminders);
        return '已取消提醒';
      }

      default:
        return `提醒工具不支持操作: ${action}`;
    }
  },
};

/**
 * 启动定时提醒检查器（每 30 秒检查一次，到期提醒打印到日志）
 */
export function startReminderChecker(intervalMs = 30_000): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const reminders = loadReminders();
    const now = Date.now();
    let fired = 0;
    for (const r of reminders) {
      if (!r.fired && new Date(r.fireAt).getTime() <= now) {
        r.fired = true;
        fired++;
        console.log(`[Reminder] ⏰ ${r.text} — 提醒时间到！`);
      }
    }
    if (fired > 0) saveReminders(reminders);
  }, intervalMs);
}
