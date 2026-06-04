/**
 * MemoryOcean — 玉瑶的记忆深海
 *
 * 毛玻璃质感的记忆晶体，Framer Motion 物理漂浮。
 * - 晶体大小 = 记忆强度
 * - 颜色 = 情绪色彩
 * - 呼吸频率 = 钙化程度
 * - 年轮 = 大颗恒星，内发光效果
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface Crystal {
  id: string;
  size: number;
  color: string;
  glow: string;
  breathDuration: number;
  opacity: number;
  isLandmark: boolean;
  floatX: number;
  floatY: number;
}

interface Props {
  decayStats?: { avgStrength: number; strongCount: number; weakCount: number };
  landmarkCount?: number;
  totalRecords?: number;
  flash?: boolean;
}

function crystalColor(pleasure: number, isLandmark: boolean): { color: string; glow: string } {
  if (isLandmark) return { color: '#ff6600', glow: 'rgba(255,102,0,0.5)' };
  if (pleasure > 0.3) return { color: '#00ff88', glow: 'rgba(0,255,136,0.25)' };
  if (pleasure < -0.3) return { color: '#ff4466', glow: 'rgba(255,68,102,0.25)' };
  return { color: '#00ffff', glow: 'rgba(0,255,255,0.25)' };
}

export default function MemoryOcean({ decayStats, landmarkCount, totalRecords, flash }: Props) {
  const crystals = useMemo<Crystal[]>(() => {
    const list: Crystal[] = [];

    if (landmarkCount && landmarkCount > 0) {
      for (let i = 0; i < Math.min(landmarkCount, 3); i++) {
        list.push({
          id: `lm-${i}`, size: 26 + Math.random() * 10,
          color: '#ff6600', glow: 'rgba(255,102,0,0.6)',
          breathDuration: 3 + Math.random() * 2, opacity: 0.95,
          isLandmark: true, floatX: -3 + Math.random() * 6, floatY: -2 + Math.random() * 4,
        });
      }
    }

    const strong = decayStats?.strongCount ?? 0;
    for (let i = 0; i < Math.min(strong, 3); i++) {
      const c = crystalColor(0.5, false);
      list.push({
        id: `st-${i}`, size: 14 + Math.random() * 8,
        color: c.color, glow: c.glow,
        breathDuration: 2 + Math.random() * 2, opacity: 0.7,
        isLandmark: false, floatX: -4 + Math.random() * 8, floatY: -3 + Math.random() * 6,
      });
    }

    for (let i = 0; i < 4; i++) {
      const pleasure = (Math.random() - 0.5) * 1.2;
      const c = crystalColor(pleasure, false);
      list.push({
        id: `nm-${i}`, size: 5 + Math.random() * 7,
        color: c.color, glow: c.glow,
        breathDuration: 2 + Math.random() * 3, opacity: 0.25 + Math.random() * 0.2,
        isLandmark: false, floatX: -5 + Math.random() * 10, floatY: -4 + Math.random() * 8,
      });
    }

    return list;
  }, [decayStats, landmarkCount]);

  const avgStr = decayStats?.avgStrength ?? 0;

  return (
    <div className="memory-ocean">
      <div className="pulse-label">
        <span className="pulse-dot" style={{ backgroundColor: '#00ff88' }} />
        记忆深海
      </div>
      <div className="ocean-floor">
        {crystals.map((cr) => (
          <motion.div
            key={cr.id}
            className={`memory-crystal${cr.isLandmark ? ' landmark' : ''}${cr.size > 12 ? ' crystal-large' : ''}${flash ? ' crystal-flash' : ''}`}
            style={{
              width: cr.size, height: cr.size,
              backgroundColor: cr.color,
              boxShadow: `0 0 ${cr.size * 0.8}px ${cr.glow}, inset 0 0 ${cr.size * 0.3}px rgba(255,255,255,0.15)`,
              opacity: cr.opacity,
              borderRadius: cr.isLandmark || cr.size > 12 ? '4px 18px 4px 18px' : '50%',
            }}
            animate={{
              scale: flash ? [1, 1.4, 1] : [1, 1 + (cr.isLandmark ? 0.12 : 0.06), 1],
              opacity: flash ? [cr.opacity, 1, cr.opacity] : [cr.opacity, cr.opacity * (cr.isLandmark ? 1.1 : 0.7), cr.opacity],
              x: [0, cr.floatX, 0],
              y: [0, cr.floatY, 0],
            }}
            transition={{
              duration: flash ? 0.6 : cr.breathDuration * 3,
              repeat: flash ? 0 : Infinity,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
      <div className="ocean-metrics">
        <span style={{ color: '#00ff88' }}>{decayStats?.strongCount ?? 0} 颗强</span>
        <span style={{ color: '#ff6600' }}>{landmarkCount ?? 0} 年轮</span>
        <span style={{ color: '#888' }}>强度 {Math.round(avgStr * 100)}%</span>
        <span style={{ color: '#555' }}>{totalRecords ?? 0} 总</span>
      </div>
    </div>
  );
}
