/**
 * types — 文件夹管理相关类型
 */

export interface WatchDirectory {
  path: string;
  name: string;
  description: string;
}

export const WATCH_DIRS: WatchDirectory[] = [
  { path: '01_待处理素材', name: 'pending', description: '用户丢入文件的入口' },
  { path: '02_知识笔记库/memos', name: 'memos', description: '备忘录类笔记' },
  { path: '02_知识笔记库/references', name: 'references', description: '参考资料类笔记' },
  { path: '02_知识笔记库/archive', name: 'archive', description: '已归档笔记' },
  { path: '03_原始附件归档', name: 'archived-raw', description: '原始文件归档副本' },
  { path: '04_回收站', name: 'trash', description: '删除文件暂存' },
];

export interface SyncReport {
  totalProcessed: number;
  successCount: number;
  failCount: number;
  errors: Array<{ file: string; error: string }>;
  startedAt: string;
  completedAt: string;
}
