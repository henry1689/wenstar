/**
 * App — 文曲星 · 全息交互终端
 *
 * 非对称布局：左侧灵魂控制台(25%) + 右侧沉浸交互区(75%)
 * 背景 #050505，邻近色切割：青碧(左侧) + 冰银(右侧) + 暖金(Logo)
 */
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import NeuralCore from './components/NeuralCore';
import StatusPanel from './components/StatusPanel';
import ThoughtStream from './components/ThoughtStream';
import ChatPanel from './components/ChatPanel';
import SettingsDock from './components/SettingsDock';
import KnowledgeBase from './components/KnowledgeBase';
import { refreshNeuralData } from './services/neuralDataService';
import { useNeuralStore } from './store/neuralStore';
import { useChatStore } from './store/chatStore';
import { fetchSomaticState } from './services/somaticService';
import './App.css';

export default function App() {
  const setMousePosition = useNeuralStore((s) => s.setMousePosition);
  const setMouseInView = useNeuralStore((s) => s.setMouseInView);
  const emotionalFlash = useChatStore((s) => s.emotionalFlash);

  // 启动时加载神经数据
  useEffect(() => {
    refreshNeuralData();
  }, []);

  // 躯体记忆轮询（每 5 秒更新粒子强度）
  const setSomaticIntensity = useNeuralStore((s) => s.setSomaticIntensity);
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const state = await fetchSomaticState();
        setSomaticIntensity(state.intensity);
      } catch {}
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
    setMousePosition(e.clientX, e.clientY);
  };

  return (
    <div
      className="app-root"
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setMouseInView(true)}
      onMouseLeave={() => setMouseInView(false)}
    >
      {/* ===== 3D 全屏背景 ===== */}
      <div className="canvas-layer">
        <NeuralCore />
      </div>

      {/* ===== 左区：灵魂控制台 (25%) ===== */}
      <motion.aside
        className={`console-left${emotionalFlash ? ' emotional-warm' : ''}`}
        initial={{ opacity: 0, x: -30 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
      >
        {/* 顶部：Logo */}
        <div className="console-logo">
          <span className="logo-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F5D76E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l1.5 6.5L20 10l-6.5 1.5L12 18l-1.5-6.5L4 10l6.5-1.5z" fill="rgba(245,215,110,0.15)" />
              <path d="M12 8v8" strokeWidth="1" opacity="0.4" />
              <path d="M8 12h8" strokeWidth="1" opacity="0.4" />
            </svg>
          </span>
          <h1 className="logo-text">
            <span className="logo-cn">文曲星</span>
            <span className="logo-en">.WenStar</span>
          </h1>
        </div>

        {/* 中部：心智流 */}
        <div className="console-main">
          <StatusPanel />
        </div>

        {/* 底部：设置舱 */}
        <SettingsDock />
      </motion.aside>

      {/* ===== 右区：沉浸交互区 (75%) ===== */}
      <div className="zone-right">
        {/* 上半：思维流 */}
        <motion.div
          className="zone-thoughts"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
        >
          <ThoughtStream />
        </motion.div>

        {/* 下半：对话窗口 */}
        <motion.div
          className="zone-chat"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
        >
          <ChatPanel inline />
        </motion.div>
      </div>

      {/* 知识库浮层 */}
      <KnowledgeBase />

      {/* 中心水印 */}
      <div className="center-hint">
        <span>移动鼠标与神经节点交互</span>
      </div>
    </div>
  );
}
