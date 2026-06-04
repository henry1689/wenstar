/**
 * ThoughtStream — 右栏：M1-M8 实时思维流
 *
 * 信息像瀑布一样自动从上往下缓慢循环流动，永不停歇。
 * 数据来源：
 * - M1~M5：来自用户聊天后的 Hermes 全管线分析
 * - M6~M8：每 15 秒轮询 /api/modules
 *
 * 未连接后端时显示占位提示。
 */
import { useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useThoughtStore, MODULE_META } from '../store/thoughtStore';
import { startPolling, stopPolling } from '../services/thoughtService';

export default function ThoughtStream() {
  const entries = useThoughtStore((s) => s.entries);
  const latestModules = useThoughtStore((s) => s.latestModules);
  const pollingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);
  const translateY = useRef(0);
  const rafRef = useRef<number>(0);

  // 首次挂载时启动 M6-M8 轮询
  useEffect(() => {
    if (!pollingRef.current) {
      pollingRef.current = true;
      startPolling();
    }
    return () => stopPolling();
  }, []);

  // 无缝循环滚动：复制一份内容 = 双倍高度
  // translateY 从 0 到 -50%，瞬间归零（内容相同，视觉无缝）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || entries.length === 0) return;
    // 用 requestAnimationFrame 驱动 transform
    const speed = 0.002; // px/frame ≈ 原速1/3

    const tick = () => {
      if (!el) { rafRef.current = requestAnimationFrame(tick); return; }
      if (!isPaused) {
        translateY.current -= speed;
        // 当第一份完全移出（-50%），瞬间归零
        if (translateY.current <= -50) {
          translateY.current = 0;
        }
        el.style.transform = `translateY(${translateY.current}%)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [entries, isPaused]);

  const hasData = entries.length > 0;

  return (
    <div className="panel thought-panel">
      <h2 className="panel-title">
        <span className="accent-orange">◇</span> 思维流
        {latestModules.m7?.total_pending > 0 && (
          <span className="thought-badge">{latestModules.m7.total_pending}</span>
        )}
      </h2>

      {/* 模块标签导航 */}
      <div className="module-strip">
        {Object.entries(MODULE_META).map(([key, meta]) => {
          const active = entries.find((e) => e.module === key);
          return (
            <span
              key={key}
              className="module-chip"
              style={{
                borderColor: active ? meta.color : 'transparent',
                color: active ? meta.color : '#333',
                opacity: active ? 1 : 0.4,
              }}
              title={meta.name}
            >
              {meta.icon}
            </span>
          );
        })}
      </div>

      <div
        className="thought-list"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {!hasData && (
          <div className="thought-empty">
            <span className="thought-empty-icon">◇</span>
            <span>暂无思维数据</span>
            <span className="thought-empty-hint">
              启动玉瑶后端 (<code>npm run webui</code>)<br />
              并在聊天面板中发送消息
            </span>
          </div>
        )}

        {/* 双倍内容实现无缝循环 */}
        <div className="thought-stream-track" ref={scrollRef}>
          {[...entries, ...entries].map((entry, idx) => {
            const meta = MODULE_META[entry.module];
            return (
              <motion.div
                key={`${entry.id}-${idx}`}
                className="thought-item"
                initial={false}
                animate={{ opacity: 1, x: 0, height: 'auto' }}
                style={{ borderLeftColor: meta?.color || '#00ffff55' }}
              >
                <div className="thought-header">
                  <span className="thought-icon" style={{ color: meta?.color }}>
                    {meta?.icon || '◇'}
                  </span>
                  <span className="thought-type" style={{ color: meta?.color }}>
                    {entry.module} {meta?.name || ''}
                  </span>
                  <span className="thought-energy">
                    {Array.from({ length: 5 }, (_, i) => (
                      <span
                        key={i}
                        className="energy-dot"
                        style={{
                          opacity: i < entry.energy * 5 ? 1 : 0.15,
                          backgroundColor: meta?.color || '#00ffff',
                        }}
                      />
                    ))}
                  </span>
                </div>
                <div className="thought-label">{entry.label}</div>
                <div className="thought-text">{entry.text}</div>
                <div className="thought-time">
                  {new Date(entry.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
