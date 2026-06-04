/**
 * CognitiveRadar — 玉瑶的心智雷达
 *
 * 能量场多边形 + 动态高亮 + 文字胶囊背板。
 * 激活维度向外扩张亮橙光，并拉出一条虚线指向中心。
 */
import { useMemo } from 'react';

interface DimDef { key: string; label: string; color: string }

const DIMENSIONS: DimDef[] = [
  { key: 'pleasure',     label: '愉悦', color: '#ff6600' },
  { key: 'intimacy',     label: '依恋', color: '#ff88aa' },
  { key: 'arousal',      label: '专注', color: '#00ffff' },
  { key: 'sincerity',    label: '共情', color: '#00ff88' },
  { key: 'logical',      label: '逻辑', color: '#8888ff' },
  { key: 'humor',        label: '幽默', color: '#ffaa00' },
  { key: 'safety',       label: '安全', color: '#88ffaa' },
  { key: 'dominance',    label: '关怀', color: '#ff4466' },
];

const DIM_KEY_MAP: Record<string, string> = {
  pleasure: 'pleasure', arousal: 'arousal', dominance: 'dominance',
  sincerity: 'sincerity', humor: 'humor', intimacy: 'intimacy',
  logical: 'logical', safety: 'safety',
};

interface Props { perception: Record<string, number> }

const N = DIMENSIONS.length;
const SIZE = 150;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 58;

function polar(i: number, radius: number): { x: number; y: number } {
  const angle = (Math.PI * 2 * i) / N - Math.PI / 2;
  return { x: CX + radius * Math.cos(angle), y: CX + radius * Math.sin(angle) };
}

export default function CognitiveRadar({ perception }: Props) {
  const dataPoints = useMemo(() => DIMENSIONS.map((dim, i) => {
    const rawVal = perception[DIM_KEY_MAP[dim.key]] ?? 0.3;
    const val = Math.max(0.05, Math.min(1, (rawVal + 1) / 2));
    const p = polar(i, R * val);
    const lp = polar(i, R + 16);
    return { ...p, labelX: lp.x, labelY: lp.y, dim, val };
  }), [perception]);

  const polyPath = dataPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z';
  const highDim = dataPoints.find((p) => p.val > 0.75);

  const grids = [0.25, 0.5, 0.75].map((level) =>
    Array.from({ length: N }, (_, i) => {
      const p = polar(i, R * level);
      return `${p.x},${p.y}`;
    }).join(' ')
  );

  return (
    <div className="radar-container" style={{ position: 'relative' }}>
      <div className="pulse-label">
        <span className="pulse-dot" style={{ backgroundColor: '#8888ff' }} />
        心智雷达
      </div>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <radialGradient id="radarGrad" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#8888ff" stopOpacity={0.25} />
            <stop offset="70%" stopColor="#8888ff" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#8888ff" stopOpacity={0} />
          </radialGradient>
          <filter id="radarGlow">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <style>{`
            @keyframes radarPulse {
              0%, 100% { opacity: 0.3; transform-origin: center; }
              50% { opacity: 1; }
            }
            @keyframes dashBreathe {
              0%, 100% { opacity: 0.3; }
              50% { opacity: 0.8; }
            }
            .pulse-dot { animation: radarPulse 1.2s ease-in-out infinite; }
            .dash-line { animation: dashBreathe 2s ease-in-out infinite; }
          `}</style>
        </defs>

        {/* 网格 */}
        {grids.map((pts, i) => (
          <polygon key={i} points={pts} fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth={1} />
        ))}

        {/* 轴线 */}
        {Array.from({ length: N }, (_, i) => {
          const e = polar(i, R);
          return <line key={i} x1={CX} y1={CX} x2={e.x} y2={e.y} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />;
        })}

        {/* 能量场 */}
        <polygon points={polyPath} fill="url(#radarGrad)" stroke="#8888ff" strokeWidth={1.5} opacity={0.8} style={{ filter: 'url(#radarGlow)' }} />

        {/* 激活维度的虚线（连向中心） */}
        {highDim && (() => {
          const dp = dataPoints.find(p => p.dim.key === highDim.dim.key);
          if (!dp) return null;
          const dist = Math.hypot(dp.x - CX, dp.y - CY);
          // 只从顶点画到半径一半
          const midX = CX + (dp.x - CX) * 0.4;
          const midY = CY + (dp.y - CY) * 0.4;
          return (
            <line x1={midX} y1={midY} x2={dp.x} y2={dp.y}
              stroke="#ff6600" strokeWidth={1.5} strokeDasharray="2,3" opacity={0.5}
              className="dash-line" />
          );
        })()}

        {/* 顶点 */}
        {dataPoints.map((p, i) => {
          const isH = p.val > 0.75 && p.dim.key === highDim?.dim.key;
          return (
            <g key={i}>
              <circle cx={p.x} cy={p.y}
                r={isH ? 6 : 3}
                fill={isH ? '#ff6600' : p.dim.color}
                opacity={isH ? 1 : 0.5 + p.val * 0.4} />
              {isH && (
                <>
                  <circle cx={p.x} cy={p.y} r={10} fill="none" stroke="#ff6600" strokeWidth={1} opacity={0.3} />
                  <circle cx={p.x} cy={p.y} r={14} fill="none" stroke="#ff6600" strokeWidth={0.8} opacity={0.2}
                    className="pulse-dot" />
                  <circle cx={p.x} cy={p.y} r={6} fill="none" stroke="#ff6600" strokeWidth={2} opacity={0.6}
                    className="pulse-dot" />
                </>
              )}
            </g>
          );
        })}
      </svg>

      {/* 标签（独立渲染，带毛玻璃胶囊背板） */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', width: SIZE, height: SIZE }}>
        {dataPoints.map((p, i) => {
          const isH = p.val > 0.75 && p.dim.key === highDim?.dim.key;
          return (
            <div key={i} style={{
              position: 'absolute',
              left: p.labelX - 20,
              top: p.labelY - 9,
              width: 40, textAlign: 'center',
              background: isH ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              borderRadius: 8,
              padding: '1px 4px',
              color: isH ? '#ff6600' : 'rgba(255,255,255,0.5)',
              fontSize: isH ? 10 : 9,
              fontWeight: isH ? 600 : 400,
              lineHeight: '16px',
              transition: 'all 0.3s',
            }}>
              {p.dim.label}
            </div>
          );
        })}
      </div>

      {highDim && (
        <div style={{
          textAlign: 'center', fontSize: 9, color: '#ff6600', marginTop: 2,
          opacity: 0.8, letterSpacing: 1,
        }}>
          {highDim.dim.label} ↑
        </div>
      )}
    </div>
  );
}
