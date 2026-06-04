/**
 * ThoughtStore — M1-M8 真实思维流数据
 *
 * 每个 thought 代表一个模块产生的"思维事件"。
 * M1-M5 来自聊天 API 响应，M6-M8 来自定时轮询。
 */
import { create } from 'zustand';

export interface ThoughtEntry {
  id: string;
  module: string;         // "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8"
  moduleName: string;     // 中文名
  label: string;          // 简短标题
  text: string;           // 详细内容
  energy: number;         // 0-1 活跃度
  timestamp: number;
}

export interface ModulesData {
  m1?: any;
  m3?: any;
  m4?: any;
  m5?: any;
  m6?: any;
  m7?: any;
  m8?: any;
  status?: any;
}

interface ThoughtStore {
  entries: ThoughtEntry[];
  /** 最近一次各模块完整快照（用于状态面板） */
  latestModules: ModulesData;

  pushThought: (entry: Omit<ThoughtEntry, 'id' | 'timestamp'>) => void;
  setModuleData: (module: keyof ModulesData, data: any) => void;
  clear: () => void;
}

const MAX_ENTRIES = 50;

export const useThoughtStore = create<ThoughtStore>((set) => ({
  entries: [],
  latestModules: {},

  pushThought: (entry) =>
    set((s) => ({
      entries: [
        {
          ...entry,
          id: `${entry.module}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
        },
        ...s.entries,
      ].slice(0, MAX_ENTRIES),
    })),

  setModuleData: (module, data) =>
    set((s) => ({
      latestModules: { ...s.latestModules, [module]: data },
    })),

  clear: () => set({ entries: [], latestModules: {} }),
}));

/** 模块配色映射 */
export const MODULE_META: Record<string, { name: string; color: string; icon: string }> = {
  M1: { name: 'DNA 编码', color: '#00ffff', icon: '🧬' },
  M2: { name: '记忆存储', color: '#8888ff', icon: '💾' },
  M3: { name: '情感感知', color: '#ff66aa', icon: '❤️' },
  M4: { name: '记忆检索', color: '#ffaa00', icon: '📖' },
  M5: { name: '表达策略', color: '#ff6600', icon: '🎯' },
  M6: { name: '自我模型', color: '#00ff88', icon: '🧠' },
  M7: { name: '梦境队列', color: '#aa66ff', icon: '🌙' },
  M8: { name: '年轮记录', color: '#ff4466', icon: '🌲' },
  IN: { name: '玉瑶感悟', color: '#ff88aa', icon: '💭' },
  RE: { name: '关系图', color: '#88ffaa', icon: '🔗' },
};
