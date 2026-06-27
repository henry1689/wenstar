/** 审计辅助函数 */
import type { CheckResult, CheckModule } from './types.js';

/** 创建成功结果 */
export function passed(id: string, name: string, module: CheckModule, detail: string, data?: Record<string, unknown>, durationMs = 0): CheckResult {
  return { id, name, module, status: 'passed', detail, data, durationMs };
}

/** 创建失败结果 */
export function failed(id: string, name: string, module: CheckModule, detail: string, data?: Record<string, unknown>, durationMs = 0): CheckResult {
  return { id, name, module, status: 'failed', detail, data, durationMs };
}

/** 创建错误结果 */
export function error(id: string, name: string, module: CheckModule, err: unknown, durationMs = 0): CheckResult {
  return { id, name, module, status: 'error', detail: '', error: String(err), durationMs };
}

/** 创建人工确认项 */
export function manual(id: string, name: string, module: CheckModule, note: string): CheckResult {
  return { id, name, module, status: 'manual', detail: note, durationMs: 0 };
}

/** 计时器 */
export function clock(): { stop(): number } {
  const start = Date.now();
  return { stop: () => Date.now() - start };
}

/** 调用 API */
export async function apiGet(path: string): Promise<any> {
  const res = await fetch(`http://localhost:3000${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

/** 调用 API POST */
export async function apiPost(path: string, body: any): Promise<any> {
  const res = await fetch(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

/** 读取 DB（通过 API，不直接操作文件） */
export async function queryDB(sql: string): Promise<any[]> {
  return apiGet(`/api/admin/query?sql=${encodeURIComponent(sql)}`);
}
