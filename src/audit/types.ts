/** 审计系统类型定义 */
export type CheckStatus = 'passed' | 'failed' | 'error' | 'manual';
export type CheckModule = 'memory' | 'knowledge' | 'profile' | 'frontend' | 'ops';

export interface CheckResult {
  id: string;
  name: string;
  module: CheckModule;
  status: CheckStatus;
  detail: string;
  data?: Record<string, unknown>;
  error?: string;
  durationMs: number;
}

export interface AuditReport {
  auditId: string;
  timestamp: string;
  commitId: string;
  branch: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    error: number;
    manual: number;
  };
  results: CheckResult[];
  recommendations: string[];
}

export type CheckFn = () => Promise<CheckResult>;
