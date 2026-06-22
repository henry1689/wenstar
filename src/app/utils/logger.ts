/**
 * P2-4: 四级日志标准化工具
 *
 * 日志前缀规则:
 *   ERROR  → 系统不可用、数据丢失、关键路径失败 → [ERR]
 *   WARN   → 外部服务降级、非关键路径失败、数据异常 → [WARN]
 *   INFO   → 正常流程关键节点 → [INFO]
 *   DEBUG  → 详细调试信息（生产环境可关闭）→ [DEBUG]
 */
export const LOG_PREFIX = {
  /** 存储层错误 */
  STORAGE_ERR: '[StorageErr]',
  /** 检索层错误 */
  RETRIEVAL_ERR: '[RetrievalErr]',
  /** 人设/人格层错误 */
  PERSONA_ERR: '[PersonaErr]',
  /** 外部服务错误 */
  EXTERNAL_ERR: '[ExternalSvcErr]',
  /** 外部服务告警 */
  EXTERNAL_WARN: '[ExternalSvcWarn]',
  /** 数据校验错误 */
  VALIDATION_ERR: '[ValidationErr]',
  /** 信息日志 */
  INFO: '[Info]',
  /** 调试日志 */
  DEBUG: '[Debug]',
};

/** 输出 ERROR 级日志 */
export function logError(tag: string, msg: string, err?: unknown): void {
  const detail = err instanceof Error ? ` | ${err.message}` : '';
  console.error(`[ERR][${tag}] ${msg}${detail}`);
}

/** 输出 WARN 级日志 */
export function logWarn(tag: string, msg: string, err?: unknown): void {
  const detail = err instanceof Error ? ` | ${err.message}` : '';
  console.warn(`[WARN][${tag}] ${msg}${detail}`);
}

/** 输出 INFO 级日志 */
export function logInfo(tag: string, msg: string): void {
  console.log(`[INFO][${tag}] ${msg}`);
}

/** 输出 DEBUG 级日志（受 DEBUG_MODE 控制） */
export function logDebug(tag: string, msg: string): void {
  if (process.env['DEBUG_MODE'] === 'true') {
    console.log(`[DEBUG][${tag}] ${msg}`);
  }
}
