/**
 * 家族图谱双库迁移配置开关
 * 支持灰度切换、回滚、流量控制
 */
/**
 * 家族图谱双库迁移配置开关
 *
 * 当前状态（阶段三·影子库收口预期）:
 *   readMode: 'compat'  → 读取优先走主库 FG，不足时回退影子库
 *   writeMode: 'dual'   → 双写主库 + 影子库（保留兜底）
 *
 * 最终状态（稳定运行后切换）:
 *   readMode: 'main'        → 仅读主库
 *   writeMode: 'main-only'  → 仅写主库（影子库停止写入）
 *
 * 切换步骤：
 *   ① readMode = 'compat'（读取优先主库）✓ 当前
 *   ② 稳跑 6-12 小时，确认无数据异常
 *   ③ readMode = 'main'（完全使用主库读取）
 *   ④ 稳跑 6-12 小时，确认无异常
 *   ⑤ writeMode = 'main-only'（停止影子库写入）
 *   ⑥ 删除所有 entity_relations 业务代码
 *   ⑦ 保留影子库表结构一个版本作为最终兜底
 */
export const FAMILY_GRAPH_MIGRATION = {
  /** 写入模式: 'shadow' → 'dual' → 'main-only' */
  writeMode: 'dual' as 'shadow' | 'dual' | 'main-only',
  /** 读取模式: 'shadow' → 'compat' → 'main' */
  readMode: 'compat' as 'shadow' | 'compat' | 'main',
  /** 主库读取流量比例 0~100（compat 模式下 FamilyGraph 优先） */
  mainReadTraffic: 100,
  /** 异常回滚开关 — 打开后恢复影子库读取 */
  emergencyFallback: false,
  /** 双写一致性日志 */
  dualWriteLogging: true,
};
