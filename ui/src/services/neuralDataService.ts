/**
 * 神经数据服务
 * 优先通过 Tauri invoke 调用 Rust 后端获取数据，
 * 回退到前端本地生成模拟数据。
 */
import type { NeuralData } from '../types/neural';
import { useNeuralStore } from '../store/neuralStore';

let tauriAvailable = true;

/** 尝试 Tauri invoke，失败时静默回退 */
async function tryTauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!tauriAvailable) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(command, args);
  } catch {
    // Tauri 后端不可用（纯前端 dev 模式）
    tauriAvailable = false;
    console.info('[NeuralData] Tauri backend unavailable, using local mock data');
    return null;
  }
}

/** 刷新神经数据 */
export async function refreshNeuralData(): Promise<void> {
  const store = useNeuralStore.getState();
  store.setLoading(true);

  try {
    // 优先从 Rust 后端获取
    const backendData = await tryTauriInvoke<NeuralData>('get_mock_neural_data', { count: 350 });

    if (backendData && backendData.nodes?.length) {
      store.setNeuralData(backendData);
      return;
    }

    // 回退：本地生成模拟数据
    const mockData = store.generateMockData(350);
    store.setNeuralData(mockData);
  } catch (err) {
    store.setError(err instanceof Error ? err.message : 'Failed to load neural data');
  }
}
