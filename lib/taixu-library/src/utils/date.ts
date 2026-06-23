/**
 * date — 日期格式化工具
 *
 * 零外部依赖。
 */

export function formatDate(ts: Date = new Date()): string {
  const y = ts.getFullYear();
  const m = String(ts.getMonth() + 1).padStart(2, '0');
  const d = String(ts.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function formatTime(ts: Date = new Date()): string {
  return String(ts.getHours()).padStart(2, '0') +
    String(ts.getMinutes()).padStart(2, '0');
}

export function formatTimestamp(ts: Date = new Date()): string {
  return ts.toISOString();
}

export function formatDateTime(ts: Date = new Date()): string {
  const y = ts.getFullYear();
  const m = String(ts.getMonth() + 1).padStart(2, '0');
  const d = String(ts.getDate()).padStart(2, '0');
  const h = String(ts.getHours()).padStart(2, '0');
  const min = String(ts.getMinutes()).padStart(2, '0');
  const s = String(ts.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}
