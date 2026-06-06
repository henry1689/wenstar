import { create } from 'zustand';
import type { NeuralData, NeuralNode } from '../types/neural';

/** 全局神经可视化状态 */
interface NeuralStore {
  // 数据
  neuralData: NeuralData | null;
  isLoading: boolean;
  error: string | null;

  // 交互
  mousePosition: { x: number; y: number };
  mouseInView: boolean;
  interactionRadius: number;

  // UI 状态
  fps: number;
  particleCount: number;
  connectionCount: number;
  somaticIntensity: number;

  // 动作
  setNeuralData: (data: NeuralData) => void;
  setMousePosition: (x: number, y: number) => void;
  setMouseInView: (inView: boolean) => void;
  setSomaticIntensity: (val: number) => void;
  setFps: (fps: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // 后端健康
  backendHealth: {
    connected: boolean;
    lastCheck: number;
    memory: { heapUsedMB: number; heapTotalMB: number };
    conversations: number;
    storageRecords: number;
    maintenance: { compaction: string | null; gc: string | null };
  } | null;
  setBackendHealth: (health: any) => void;

  // 生成模拟数据（离线回退）
  generateMockData: (count: number) => NeuralData;
}

/** 生成随机节点 */
function randomNode(id: number): NeuralNode {
  const range = 12;
  return {
    id,
    x: (Math.random() - 0.5) * range * 2,
    y: (Math.random() - 0.5) * range * 2,
    z: (Math.random() - 0.5) * range * 2,
    energy: 0.3 + Math.random() * 0.7,
    group: Math.floor(Math.random() * 5),
  };
}

/** 计算节点间连接 */
function computeConnections(nodes: NeuralNode[], threshold = 5.5): NeuralConnection[] {
  const connections: NeuralConnection[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      const dz = nodes[i].z - nodes[j].z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < threshold) {
        const strength = 1 - dist / threshold;
        connections.push({ source: i, target: j, strength });
      }
    }
  }
  return connections;
}

export const useNeuralStore = create<NeuralStore>((set) => ({
  neuralData: null,
  isLoading: true,
  error: null,

  mousePosition: { x: 0, y: 0 },
  mouseInView: false,
  interactionRadius: 4,

  fps: 0,
  particleCount: 0,
  connectionCount: 0,
  somaticIntensity: 0,

  backendHealth: null,
  setBackendHealth: (health) => set({ backendHealth: health }),

  setNeuralData: (data) =>
    set({
      neuralData: data,
      particleCount: data.nodes.length,
      connectionCount: data.connections.length,
      isLoading: false,
    }),

  setMousePosition: (x, y) => set({ mousePosition: { x, y } }),
  setMouseInView: (inView) => set({ mouseInView: inView }),
  setSomaticIntensity: (val) => set({ somaticIntensity: val }),
  setFps: (fps) => set({ fps }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error, isLoading: false }),

  generateMockData: (count: number) => {
    const nodes = Array.from({ length: count }, (_, i) => randomNode(i));
    const connections = computeConnections(nodes);
    return { nodes, connections, timestamp: Date.now() };
  },
}));
