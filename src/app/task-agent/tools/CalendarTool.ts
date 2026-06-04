/**
 * CalendarTool — 日历管理
 * 内存存储 + JSON 文件持久化
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ITool, CalendarEvent } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_FILE = join(__dirname, '..', '..', '..', '..', 'data', 'webui', 'calendar.json');

function loadEvents(): CalendarEvent[] {
  try {
    if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch (err) { console.warn("[Calendar] 加载失败:", err); }
  return [];
}

function saveEvents(events: CalendarEvent[]): void {
  const dir = dirname(DATA_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(events, null, 2), 'utf-8');
}

export const calendarTool: ITool = {
  name: 'calendar',
  description: '日历管理：创建/查询/修改/删除日程',

  async execute(action: string, params: Record<string, any>): Promise<string> {
    const events = loadEvents();

    switch (action) {
      case 'create': {
        const ev: CalendarEvent = {
          id: `ev_${Date.now().toString(36)}`,
          title: params.title || '未命名事件',
          time: params.time || new Date().toISOString(),
          duration: params.duration,
          note: params.note,
          created_at: new Date().toISOString(),
        };
        events.push(ev);
        saveEvents(events);
        return `已创建日程: "${ev.title}" 于 ${ev.time}`;
      }

      case 'list': {
        const upcoming = events
          .sort((a, b) => a.time.localeCompare(b.time))
          .slice(0, 10);
        if (upcoming.length === 0) return '暂无日程';
        return upcoming.map(e =>
          `📅 ${e.time.substring(0, 16)} — ${e.title}${e.note ? ` (${e.note})` : ''}`
        ).join('\n');
      }

      case 'delete': {
        const idx = events.findIndex(e => e.id === params.id);
        if (idx < 0) return '未找到该日程';
        const removed = events.splice(idx, 1)[0];
        saveEvents(events);
        return `已删除日程: "${removed.title}"`;
      }

      default:
        return `日历工具不支持操作: ${action}`;
    }
  },
};
