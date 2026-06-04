/**
 * ApiKeyStorage — API Key 持久化存储
 *
 * 将 LLM API Key 存储在 data/webui/api_keys.json 中，
 * 支持运行时动态读写，无需重启服务器。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_FILE = join(__dirname, '..', '..', '..', 'data', 'webui', 'api_keys.json');

interface KeyEntry {
  name: string;
  value: string;
  label: string;
  created_at: string;
}

function loadKeys(): KeyEntry[] {
  try {
    if (existsSync(DATA_FILE)) {
      return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return [];
}

function saveKeys(keys: KeyEntry[]): void {
  const dir = dirname(DATA_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(keys, null, 2), 'utf-8');
}

/** 获取所有 API Key（value 已打码） */
export function listKeys(): KeyEntry[] {
  const keys = loadKeys();
  return keys.map(k => ({
    ...k,
    value: k.value.length > 8
      ? k.value.substring(0, 4) + '****' + k.value.substring(k.value.length - 4)
      : '****',
  }));
}

/** 获取原始 Key 值（仅供内部使用） */
export function getKeyValue(name: string): string | null {
  const keys = loadKeys();
  return keys.find(k => k.name === name)?.value ?? null;
}

/** 添加或更新 Key */
export function setKey(name: string, value: string, label?: string): KeyEntry {
  const keys = loadKeys();
  const existing = keys.findIndex(k => k.name === name);
  const entry: KeyEntry = {
    name,
    value,
    label: label || name,
    created_at: existing >= 0 ? keys[existing].created_at : new Date().toISOString(),
  };
  if (existing >= 0) {
    keys[existing] = entry;
  } else {
    keys.push(entry);
  }
  saveKeys(keys);
  return { ...entry, value: entry.value.length > 8 ? entry.value.substring(0, 4) + '****' + entry.value.substring(entry.value.length - 4) : '****' };
}

/** 删除 Key */
export function deleteKey(name: string): boolean {
  const keys = loadKeys();
  const idx = keys.findIndex(k => k.name === name);
  if (idx < 0) return false;
  keys.splice(idx, 1);
  saveKeys(keys);
  return true;
}
