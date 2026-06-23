/**
 * hash — 哈希工具函数
 *
 * FNV-1a 非加密哈希实现（与主程序一致）。
 * 零外部依赖。
 */

/** FNV-1a 32-bit 哈希 */
export function fnv1a(data: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash);
}

/** 取模到指定位数的 hex */
export function hashToHex(data: string, bits: number = 1): string {
  return (fnv1a(data) % Math.pow(16, bits)).toString(16).toUpperCase().padStart(bits, '0');
}
