/**
 * 家族图谱双库迁移配置开关
 * 支持灰度切换、回滚、流量控制
 */
export const FAMILY_GRAPH_MIGRATION = {
  /** 写入模式: 'shadow'（仅影子库/旧行为）→ 'dual'（双写主库+影子库）→ 'main-only'（仅主库） */
  writeMode: 'shadow' as 'shadow' | 'dual' | 'main-only',
  /** 读取模式: 'shadow'（影子库）→ 'compat'（适配层）→ 'main'（主库） */
  readMode: 'shadow' as 'shadow' | 'compat' | 'main',
  /** 主库读取流量比例 0~100 */
  mainReadTraffic: 0,
  /** 异常回滚开关 — 打开后恢复影子库读取 */
  emergencyFallback: false,
  /** 是否启用双写一致性对比日志 */
  dualWriteLogging: true,
};
