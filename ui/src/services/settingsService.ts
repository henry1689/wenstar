/**
 * SettingsService — 设置 API 客户端
 */
const API_BASE = '/api';

export interface KeyEntry {
  name: string;
  value: string;
  label: string;
  created_at: string;
}

/** 获取所有 API Key（已打码） */
export async function fetchKeys(): Promise<KeyEntry[]> {
  const res = await fetch(`${API_BASE}/keys`);
  if (!res.ok) throw new Error(`Keys error: ${res.status}`);
  const data = await res.json();
  return data.keys || [];
}

/** 添加或更新 Key */
export async function saveKey(name: string, value: string, label?: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, value, label }),
  });
  return res.ok;
}

/** 删除 Key */
export async function removeKey(name: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/keys`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.ok;
}
