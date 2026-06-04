/** 单个神经节点（粒子）数据 */
export interface NeuralNode {
  id: number;
  x: number;
  y: number;
  z: number;
  energy: number;       // 0–1 能量值，影响大小和亮度
  group: number;         // 分组 ID，决定颜色
  label?: string;       // 可选标签
}

/** 节点之间的连接 */
export interface NeuralConnection {
  source: number;
  target: number;
  strength: number;     // 0–1 连接强度
}

/** 完整的神经网络快照 */
export interface NeuralData {
  nodes: NeuralNode[];
  connections: NeuralConnection[];
  timestamp: number;
}

/** 分组颜色映射 */
export const GROUP_COLORS: Record<number, string> = {
  0: '#00ffff',  // 青色 Cyan — 主色
  1: '#ff8844',  // 暖橙 Warm Orange — 情绪点缀
  2: '#f0d8b0',  // 暖白 Warm White — 透气孔
  3: '#00cc99',  // 青绿 Teal — 邻近色
  4: '#8888ff',  // 淡紫 Lavender — 辅助
};

/** 3D 场景中粒子状态（含运行时动画数据） */
export interface ParticleState {
  id: number;
  position: [number, number, number];
  basePosition: [number, number, number];
  velocity: [number, number, number];
  energy: number;
  group: number;
  scale: number;
  phase: number; // 呼吸相位偏移
}
