/** 任务代理 · 类型定义 */

export interface TaskStep {
  tool: string;
  action: string;
  params: Record<string, any>;
}

export interface TaskPlan {
  summary: string;
  steps: TaskStep[];
}

export interface TaskResult {
  success: boolean;
  summary: string;
  details: string[];
  error?: string;
}

export interface ITool {
  readonly name: string;
  readonly description: string;
  execute(action: string, params: Record<string, any>): Promise<string>;
}

/** 日历事件 */
export interface CalendarEvent {
  id: string;
  title: string;
  time: string;
  duration?: number;
  note?: string;
  created_at: string;
}

/** 提醒 */
export interface Reminder {
  id: string;
  text: string;
  fireAt: string;
  fired: boolean;
  created_at: string;
}

/** 笔记 */
export interface Note {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}
