/**
 * NoteTool — 笔记管理
 * 内存存储 + JSON 文件持久化
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ITool, Note } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_FILE = join(__dirname, '..', '..', '..', '..', 'data', 'webui', 'notes.json');

function loadNotes(): Note[] {
  try {
    if (existsSync(DATA_FILE)) return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
  } catch (err) { console.warn("[Note] 加载失败:", err); }
  return [];
}

function saveNotes(notes: Note[]): void {
  const dir = dirname(DATA_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(notes, null, 2), 'utf-8');
}

export const noteTool: ITool = {
  name: 'note',
  description: '笔记管理：创建/查询/删除笔记',

  async execute(action: string, params: Record<string, any>): Promise<string> {
    const notes = loadNotes();

    switch (action) {
      case 'create': {
        const note: Note = {
          id: `nt_${Date.now().toString(36)}`,
          title: params.title || '无标题',
          content: params.content || '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        notes.push(note);
        saveNotes(notes);
        return `📝 已记录笔记: "${note.title}"`;
      }

      case 'list': {
        if (notes.length === 0) return '暂无笔记';
        return notes.slice(-10).reverse().map(n =>
          `📝 ${n.title} (${n.created_at.substring(0, 10)})`
        ).join('\n');
      }

      case 'search': {
        const kw = (params.keyword || '').toLowerCase();
        const hits = notes.filter(n =>
          n.title.toLowerCase().includes(kw) || n.content.toLowerCase().includes(kw)
        ).slice(0, 5);
        if (hits.length === 0) return `未找到包含 "${kw}" 的笔记`;
        return hits.map(n => `📝 ${n.title}: ${n.content.substring(0, 60)}`).join('\n');
      }

      case 'delete': {
        const idx = notes.findIndex(n => n.id === params.id);
        if (idx < 0) return '未找到该笔记';
        notes.splice(idx, 1);
        saveNotes(notes);
        return '已删除笔记';
      }

      default:
        return `笔记工具不支持操作: ${action}`;
    }
  },
};
