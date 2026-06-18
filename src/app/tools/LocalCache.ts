/**
 * LocalCache — 本地文件缓存工具类
 *
 * 职责: 提供内存 + 文件持久化双层的通用缓存。
 *      内存层快速读写，文件层支持进程间复用。
 *
 * 设计原则:
 *   1. 纯工具，不依赖任何业务模块
 *   2. 按 TTL 自动过期，惰性清理
 *   3. 可选文件持久化（写入 data/webui/cache/）
 *   4. 容量上限（maxKeys），超限按 LRU 淘汰
 *
 * 用法:
 *   const cache = new LocalCache<string, any>({ ttlMs: 5 * 60 * 1000, namespace: 'kb' });
 *   await cache.set('key', value);
 *   const v = await cache.get('key'); // null 表示过期或不存在
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ─── 类型 ───

export interface LocalCacheOptions {
  /** 默认 TTL (ms)，默认 5 分钟 */
  ttlMs?: number;
  /** 缓存命名空间（用于文件隔离），默认 'default' */
  namespace?: string;
  /** 持久化目录，默认 data/webui/cache/ */
  persistDir?: string;
  /** 最大键数量，超限按 LRU 淘汰，默认 1000 */
  maxKeys?: number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;   // 过期时间戳 (ms)，0 = 永不过期
  createdAt: number;
  accessCount: number; // 用于 LRU 淘汰辅助
}

// ─── 工具类 ───

export class LocalCache<K, V> {
  private store = new Map<string, CacheEntry<V>>();
  private ttlMs: number;
  private namespace: string;
  private persistDir: string;
  private maxKeys: number;

  constructor(options: LocalCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.namespace = options.namespace ?? 'default';
    this.persistDir = options.persistDir ?? join(process.cwd(), 'data', 'webui', 'cache');
    this.maxKeys = options.maxKeys ?? 1000;
  }

  // ─── 公开方法 ───

  /** 写入缓存。ttl 覆盖构造参数，0 为永不过期 */
  async set(key: K, value: V, ttlMs?: number): Promise<void> {
    const sk = this.serializeKey(key);
    const now = Date.now();

    // 容量检查：达到上限时淘汰最旧的 20%
    if (this.store.size >= this.maxKeys) {
      this.evict(now);
    }

    this.store.set(sk, {
      value,
      expiresAt: ttlMs === 0 ? 0 : now + (ttlMs ?? this.ttlMs),
      createdAt: now,
      accessCount: 0,
    });

    // 文件持久化（异步写入）
    this.persist(sk).catch(() => { /* 持久化失败不影响主流程 */ });
  }

  /** 读取缓存。过期或不存在返回 null */
  async get(key: K): Promise<V | null> {
    const sk = this.serializeKey(key);
    const entry = this.store.get(sk);
    if (!entry) {
      // 尝试从文件恢复
      const restored = await this.restore(sk);
      if (!restored) return null;
      this.store.set(sk, restored);
      return restored.value;
    }

    // 检查过期
    if (entry.expiresAt !== 0 && Date.now() > entry.expiresAt) {
      this.store.delete(sk);
      this.removePersistFile(sk).catch(() => {});
      return null;
    }

    entry.accessCount++;
    return entry.value;
  }

  /** 检查 key 是否存在且未过期 */
  async has(key: K): Promise<boolean> {
    const v = await this.get(key);
    return v !== null;
  }

  /** 删除指定 key */
  async delete(key: K): Promise<boolean> {
    const sk = this.serializeKey(key);
    const existed = this.store.has(sk);
    this.store.delete(sk);
    await this.removePersistFile(sk);
    return existed;
  }

  /** 清空当前命名空间的所有缓存 */
  async clear(): Promise<void> {
    this.store.clear();
    await this.clearPersistFiles();
  }

  /** 当前缓存条目数 */
  size(): number {
    return this.store.size;
  }

  /** 清理所有过期条目 */
  async prune(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [sk, entry] of this.store) {
      if (entry.expiresAt !== 0 && now > entry.expiresAt) {
        this.store.delete(sk);
        removed++;
      }
    }
    return removed;
  }

  // ─── 内部方法 ───

  private serializeKey(key: K): string {
    return `${this.namespace}:${JSON.stringify(key)}`;
  }

  /** LRU 淘汰：移除最旧的 20% */
  private evict(now: number): void {
    const sorted = [...this.store.entries()]
      .filter(([, e]) => e.expiresAt === 0 || e.expiresAt > now)
      .sort((a, b) => a[1].accessCount - b[1].accessCount || a[1].createdAt - b[1].createdAt);

    const removeCount = Math.max(1, Math.floor(this.maxKeys * 0.2));
    for (let i = 0; i < removeCount && i < sorted.length; i++) {
      this.store.delete(sorted[i][0]);
    }
  }

  /** 写入持久化文件 */
  private async persist(sk: string): Promise<void> {
    const entry = this.store.get(sk);
    if (!entry) return;
    if (!existsSync(this.persistDir)) mkdirSync(this.persistDir, { recursive: true });

    const filePath = join(this.persistDir, `${this.safeFileName(sk)}.json`);
    const data = JSON.stringify({
      value: entry.value,
      expiresAt: entry.expiresAt,
      createdAt: entry.createdAt,
    });
    writeFileSync(filePath, data, 'utf-8');
  }

  /** 从文件恢复 */
  private async restore(sk: string): Promise<CacheEntry<V> | null> {
    const filePath = join(this.persistDir, `${this.safeFileName(sk)}.json`);
    if (!existsSync(filePath)) return null;
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.expiresAt !== 0 && Date.now() > data.expiresAt) {
        unlinkSync(filePath);
        return null;
      }
      return { value: data.value, expiresAt: data.expiresAt, createdAt: data.createdAt, accessCount: 0 };
    } catch {
      return null;
    }
  }

  private async removePersistFile(sk: string): Promise<void> {
    const filePath = join(this.persistDir, `${this.safeFileName(sk)}.json`);
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
  }

  private async clearPersistFiles(): Promise<void> {
    if (!existsSync(this.persistDir)) return;
    const prefix = `${this.namespace}:`;
    for (const f of readdirSync(this.persistDir)) {
      if (f.startsWith(prefix) && f.endsWith('.json')) {
        try { unlinkSync(join(this.persistDir, f)); } catch { /* ignore */ }
      }
    }
  }

  private safeFileName(sk: string): string {
    return sk.replace(/[^a-zA-Z0-9_:.-]/g, '_').substring(0, 200);
  }
}
