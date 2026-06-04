/**
 * TaskAgentEngine — 任务代理编排器
 *
 * 接收用户自然语言指令 → plan → execute → 返回结果
 */
import { ToolRegistry } from './ToolRegistry.js';
import { plan } from './TaskPlanner.js';
import type { TaskResult } from './types.js';

export class TaskAgentEngine {
  async execute(input: string): Promise<TaskResult> {
    const taskPlan = plan(input);
    if (!taskPlan) {
      return {
        success: false,
        summary: '无法理解指令',
        details: [],
        error: '无法从输入中解析出可执行的任务步骤',
      };
    }

    const details: string[] = [];

    for (const step of taskPlan.steps) {
      try {
        const result = await ToolRegistry.execute(step.tool, step.action, step.params);
        details.push(result);
      } catch (err: any) {
        details.push(`❌ ${step.tool}/${step.action} 失败: ${err.message}`);
      }
    }

    const allOk = details.every(d => !d.startsWith('❌'));

    return {
      success: allOk,
      summary: allOk
        ? `✅ ${taskPlan.summary}`
        : `⚠️ ${taskPlan.summary} (部分步骤失败)`,
      details,
    };
  }
}
