/**
 * DnaGenerator — HY-DNA 编码生成器
 *
 * 与主程序 M1 DNAEncoder 的生成规则 100% 一致。
 * 根码格式: DNA-YYYYMMDD-HHmm-NNNN-HX
 * 瑶印码: FNV-1a 哈希, 同一用户同一天产出一致
 */

export type ModuleCode = 'LIB' | 'RAW' | 'WIKI' | 'IDX';

export class DnaGenerator {
  private seqCounters: Map<string, number> = new Map();

  /**
   * 生成 HY-DNA 根码
   */
  generateRootId(userId: string, timestamp?: Date): string {
    const ts = timestamp ?? new Date();
    const dateStr = this.formatDate(ts);
    const timeStr = this.formatTime(ts);
    const seqNo = this.getNextSeqNo(dateStr);
    const hyStamp = this.generateHYStamp(userId, dateStr);
    return `DNA-${dateStr}-${timeStr}-${seqNo}-${hyStamp}`;
  }

  /**
   * 生成环节特征码
   */
  generateSubId(rootId: string, moduleCode: ModuleCode, seqNo: number = 1): string {
    return `${rootId}.${moduleCode}.${String(seqNo).padStart(3, '0')}`;
  }

  /**
   * 瑶印码 (FNV-1a 非加密哈希)
   */
  generateHYStamp(userId: string, dateStr: string): string {
    let hash = 0x811c9dc5;
    const data = `${userId}:${dateStr}`;
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (Math.abs(hash) % 16).toString(16).toUpperCase();
  }

  /**
   * 从现有数据恢复计数器（启动时调用）
   */
  restoreCounter(dateStr: string, lastSeqNo: number): void {
    this.seqCounters.set(dateStr, lastSeqNo);
  }

  private formatDate(ts: Date): string {
    const y = ts.getFullYear();
    const m = String(ts.getMonth() + 1).padStart(2, '0');
    const d = String(ts.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  private formatTime(ts: Date): string {
    return String(ts.getHours()).padStart(2, '0') +
      String(ts.getMinutes()).padStart(2, '0');
  }

  private getNextSeqNo(dateStr: string): string {
    const current = this.seqCounters.get(dateStr) ?? -1;
    const next = current + 1;
    this.seqCounters.set(dateStr, next);
    return String(next % 10000).padStart(4, '0');
  }
}
