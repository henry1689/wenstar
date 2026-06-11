/**
 * StatusPanel — 玉瑶 · 心智流 (MindStream)
 *
 * 不是监控面板，是她灵魂的窗户。
 * 四个模块：情绪脉搏 → 心智雷达 → 记忆深海 → 工作记忆流
 */
import { useEffect, useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { useNeuralStore } from '../store/neuralStore';
import { useThoughtStore } from '../store/thoughtStore';
import { useChatStore } from '../store/chatStore';
import { fetchHealth } from '../services/chatService';
import EmotionalPulse from './EmotionalPulse';
import CognitiveRadar from './CognitiveRadar';
import MemoryOcean from './MemoryOcean';
import WorkingMemoryTicker from './WorkingMemoryTicker';

export default function StatusPanel() {
  const fps = useNeuralStore((s) => s.fps);
  const isLoading = useNeuralStore((s) => s.isLoading);
  const backendHealth = useNeuralStore((s) => s.backendHealth);
  const emotionalFlash = useChatStore((s) => s.emotionalFlash);
  const setBackendHealth = useNeuralStore((s) => s.setBackendHealth);

  const latestThoughts = useThoughtStore((s) => s.latestModules);

  /** 从 M3 数据中提取当前愉悦度和唤醒度 */
  const [pleasure, setPleasure] = useState(0);
  const [arousal, setArousal] = useState(0);
  const [perception, setPerception] = useState<Record<string, number>>({});

  // 从思维流数据更新情绪指标
  const updateEmotion = useCallback(() => {
    const m3 = latestThoughts.m3;
    if (m3?.quadrant1) {
      const p = m3.quadrant1.find((d: any) => d.key === 'pleasure');
      const a = m3.quadrant1.find((d: any) => d.key === 'arousal');
      if (p) setPleasure(p.value);
      if (a) setArousal(a.value);

      // 收集所有维度用于雷达图
      const all: Record<string, number> = {};
      for (const q of ['quadrant1', 'quadrant2', 'quadrant3', 'quadrant4']) {
        for (const d of m3[q] ?? []) {
          all[d.key] = d.value;
        }
      }
      setPerception((prev) => ({ ...prev, ...all }));
    }
  }, [latestThoughts]);

  useEffect(() => {
    updateEmotion();
  }, [updateEmotion]);

  // 心跳轮询后端健康
  useEffect(() => {
    const poll = async () => {
      try {
        const h = await fetchHealth();
        setBackendHealth(h);
      } catch {
        setBackendHealth({ connected: false, lastCheck: Date.now() });
      }
    };
    poll();
    const timer = setInterval(poll, 15_000);
    return () => clearInterval(timer);
  }, [setBackendHealth]);

  const isHealthy = backendHealth?.connected !== false && backendHealth !== null;
  const decay = backendHealth?.memory?.decay;
  const landmarks = backendHealth?.memory?.landmarks ?? 0;
  const totalRecords = backendHealth?.storage?.totalRecords ?? backendHealth?.storageRecords ?? 0;
  const conversationCount = backendHealth?.conversations?.total ?? 0;

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.15 } },
  };

  const itemAnim = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <motion.div
      className="panel status-panel mindstream"
      variants={container}
      initial="hidden"
      animate="show"
    >
      {/* ── 顶部：状态标题 ── */}
      <motion.div className="mindstream-header" variants={itemAnim}>
        <div className="ms-title">
          <span className="ms-avatar">💠</span>
          <div>
            <div className="ms-name">玉瑶</div>
            <div className="ms-subtitle">
              <span
                className="ms-status-dot"
                style={{ background: isHealthy ? '#00ff88' : '#ff4444' }}
              />
              {isHealthy ? '心智活跃' : '离线'}
            </div>
          </div>
        </div>
        <div className="ms-fps">{isLoading ? '--' : fps}<span className="ms-fps-unit">FPS</span></div>
      </motion.div>

      {/* ── 手机网络访问提示 ── */}
      <motion.div className="network-hint" variants={itemAnim}>
        📱 同一WiFi：<a href="http://192.168.10.114:5174" target="_blank" rel="noopener">http://192.168.10.114:5174</a>
        <div className="network-hint-sub">📞电话模式→键盘🎤说话→5秒自动发送</div>
        <div className="network-hint-sub">📶 4G/5G：<a href="https://emphasis-michel-align-vpn.trycloudflare.com" target="_blank" rel="noopener" style={{color:'#4ade80'}}>点此打开公网版</a>（电话模式完整功能）</div>
      </motion.div>

      {/* ── ① 情绪脉搏 ── */}
      <motion.div variants={itemAnim}>
        <EmotionalPulse
          pleasure={pleasure}
          arousal={arousal}
          active={isHealthy}
        />
      </motion.div>

      <div className="divider" />

      {/* ── ② 心智雷达 ── */}
      <motion.div variants={itemAnim}>
        <CognitiveRadar perception={perception} />
      </motion.div>

      <div className="divider" />

      {/* ── ③ 记忆深海 ── */}
      <motion.div variants={itemAnim}>
        <MemoryOcean
          decayStats={decay ? { avgStrength: decay.avgStrength, strongCount: decay.strongCount, weakCount: decay.weakCount } : undefined}
          landmarkCount={landmarks}
          totalRecords={totalRecords}
          flash={emotionalFlash}
        />
      </motion.div>

      <div className="divider" />

      {/* ── 连接状态（极简指标行） ── */}
      <motion.div className="ms-metrics" variants={itemAnim}>
        <span style={{ color: '#888' }}>
          {totalRecords} 记忆 · {conversationCount} 对话
        </span>
        <span style={{ color: isHealthy ? '#00ff88' : '#ff4444', fontSize: 10 }}>
          {isHealthy ? '● 在线' : '● 离线'}
        </span>
      </motion.div>

      <div className="divider" />

      {/* ── ④ 工作记忆流 ── */}
      <motion.div variants={itemAnim}>
        <WorkingMemoryTicker active={isHealthy} />
      </motion.div>
    </motion.div>
  );
}
