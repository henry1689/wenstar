/**
 * EmotionalPulse — 玉瑶的情绪脉搏
 *
 * 液态金属质感的水波纹，带拖尾效果。
 * pleasure 高 → 暖橙；arousal 高 → 振幅大、速度快。
 * ❤️ 红心随 arousal 自动跳动：越激动跳得越快越猛。
 */
import { useRef, useEffect, useState } from 'react';

interface Props {
  pleasure: number;
  arousal: number;
  active?: boolean;
}

const WIDTH = 260;
const HEIGHT = 64;

const TRAIL_LENGTH = 12;

export default function EmotionalPulse({ pleasure, arousal, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heartRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<number[][]>([]);
  const [pulseColor, setPulseColor] = useState('#00ffff');
  const targetColorRef = useRef('#00ffff');
  const currentColorRef = useRef('#00ffff');
  const heartPhaseRef = useRef(0);

  // 情绪标签
  const moodLabel = pleasure > 0.6 ? '很开心' : pleasure > 0.3 ? '心情好' : pleasure < -0.4 ? '有点低落' : arousal > 0.6 ? '有点激动' : '平静';

  // 动态色温映射：pleasure ∈ [-1,1] → 色相从 180°(cyan) 到 30°(orange) 到 350°(red)
  function pleasureToColor(p: number): string {
    const n = (p + 1) / 2;
    const r = Math.round(50 + n * 205);
    const g = Math.round(200 - n * 140);
    const b = Math.round(200 - n * 170);
    return `#${[r,g,b].map(c => Math.min(255,Math.max(0,c)).toString(16).padStart(2,'0')).join('')}`;
  }

  useEffect(() => {
    targetColorRef.current = pleasureToColor(pleasure);
  }, [pleasure]);

  function lerpColor(a: string, b: string, t: number): string {
    const ah = parseInt(a.slice(1), 16), ar = ah >> 16, ag = (ah >> 8) & 255, ab = ah & 255;
    const bh = parseInt(b.slice(1), 16), br = bh >> 16, bg = (bh >> 8) & 255, bb = bh & 255;
    const rr = Math.round(ar + (br - ar) * t);
    const rg = Math.round(ag + (bg - ag) * t);
    const rb = Math.round(ab + (bb - ab) * t);
    return `#${((1 << 24) + (rr << 16) + (rg << 8) + rb).toString(16).slice(1)}`;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let animId: number;
    let smoothArousal = arousal || 0;

    const draw = () => {
      // 🔥 ECG 速度随 arousal：平静慢速(~0.005)，激动快速(~0.035)
      const rawSpeed = 0.004 + Math.max(0.1, smoothArousal) * 0.035;
      const speedScale = Math.min(0.05, rawSpeed);
      frame += speedScale;

      // 心率：同步给 ❤️ 跳动
      const hr = 0.5 + smoothArousal * 0.8; // 心跳频率
      heartPhaseRef.current += hr * 0.02;
      const beat = Math.abs(Math.sin(heartPhaseRef.current));
      // 收缩曲线：快速收缩 + 缓慢恢复（模拟真实心跳）
      const beatVal = beat > 0.85 ? 1 : beat > 0.6 ? 0.6 : 0.3;
      if (heartRef.current) {
        heartRef.current.style.transform = `scale(${1 + beatVal * Math.max(0.2, smoothArousal) * 0.9})`;
      }

      smoothArousal += ((arousal || 0) - smoothArousal) * ((arousal || 0) > smoothArousal ? 0.08 : 0.007);
      const ea = Math.max(0.15, smoothArousal);

      // 每帧平滑过渡颜色
      const t = 0.04;
      currentColorRef.current = lerpColor(currentColorRef.current, targetColorRef.current, t);
      const color = currentColorRef.current;
      if (frame % 5 < 0.03) setPulseColor(color);

      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      const baseY = HEIGHT / 2;
      const ampScale = 0.5 + ea * 2.8;
      const amplitude = Math.max(8, ampScale * 22);
      const freqBase = 0.02 + ea * 0.08;
      const freq = active ? freqBase * 1.5 : freqBase;

      // 计算拖尾点
      const lastX = WIDTH;
      const lastY = baseY
        + Math.sin(lastX * freq + frame) * amplitude
        + Math.sin(lastX * freq * 2 + frame * 1.3) * amplitude * 0.4
        + Math.sin(lastX * freq * 0.5 + frame * 0.7) * amplitude * 0.2;
      trailRef.current.push([lastX, lastY]);
      if (trailRef.current.length > TRAIL_LENGTH) trailRef.current.shift();

      // ① arousal 边缘红光
      const intense = ea > 0.4;
      if (intense) {
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= WIDTH; x += 1) {
          ctx.lineTo(x, baseY
            + Math.sin(x * freq + frame) * amplitude
            + Math.sin(x * freq * 2 + frame * 1.3) * amplitude * 0.4
            + Math.sin(x * freq * 0.5 + frame * 0.7) * amplitude * 0.2);
        }
        ctx.strokeStyle = '#ff336666';
        ctx.lineWidth = 12;
        ctx.shadowColor = '#ff3366';
        ctx.shadowBlur = 40;
        ctx.stroke();
      }

      // ② 深层光晕
      ctx.beginPath();
      ctx.moveTo(0, baseY);
      for (let x = 0; x <= WIDTH; x += 1) {
        ctx.lineTo(x, baseY
          + Math.sin(x * freq + frame) * amplitude
          + Math.sin(x * freq * 2 + frame * 1.3) * amplitude * 0.4
          + Math.sin(x * freq * 0.5 + frame * 0.7) * amplitude * 0.2);
      }
      ctx.strokeStyle = color + '44';
      ctx.lineWidth = 8;
      ctx.shadowColor = color;
      ctx.shadowBlur = intense ? 70 : 30;
      ctx.stroke();

      // ② 主波
      ctx.beginPath();
      ctx.moveTo(0, baseY);
      for (let x = 0; x <= WIDTH; x += 1) {
        ctx.lineTo(x, baseY
          + Math.sin(x * freq + frame) * amplitude
          + Math.sin(x * freq * 2 + frame * 1.3) * amplitude * 0.4
          + Math.sin(x * freq * 0.5 + frame * 0.7) * amplitude * 0.2);
      }
      ctx.shadowBlur = 12;
      ctx.lineWidth = 3.5;
      const grad = ctx.createLinearGradient(0, 0, WIDTH, 0);
      grad.addColorStop(0, color + '33');
      grad.addColorStop(0.2, color);
      grad.addColorStop(0.8, color);
      grad.addColorStop(1, color + '33');
      ctx.strokeStyle = grad;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // ③ 涟漪填充
      ctx.lineTo(WIDTH, HEIGHT);
      ctx.lineTo(0, HEIGHT);
      ctx.closePath();
      const fillGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
      fillGrad.addColorStop(0, color + '15');
      fillGrad.addColorStop(0.4, color + '08');
      fillGrad.addColorStop(1, color + '00');
      ctx.fillStyle = fillGrad;
      ctx.fill();

      // ④ 拖尾
      const _trail = trailRef.current;
      for (let t = 0; t < _trail.length; t++) {
        const alpha = (t / _trail.length) * 0.25;
        const radius = (t / _trail.length) * 3;
        ctx.beginPath();
        ctx.arc(_trail[t][0], _trail[t][1], radius, 0, Math.PI * 2);
        ctx.fillStyle = color + Math.floor(alpha * 40).toString(16).padStart(2, '0');
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animId);
  }, [pleasure, arousal, active]);

  return (
    <div className="pulse-container">
      <div className="pulse-label">
        <span className="pulse-dot" style={{ backgroundColor: pulseColor }} />
        情绪脉搏
      </div>
      <div className="pulse-wave">
        <div style={{ position: 'relative', width: WIDTH, height: HEIGHT }}>
          <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
          {/* ❤️ 红心 — JS 驱动缩放，跟随 arousal */}
          <div ref={heartRef} style={{
            position: 'absolute',
            right: 6,
            top: 4,
            transform: 'scale(1)',
            transformOrigin: 'center center',
            fontSize: 22,
            lineHeight: 1,
            filter: `drop-shadow(0 0 ${4 + Math.abs(arousal) * 8}px rgba(255,50,80,${0.3 + Math.abs(arousal) * 0.5}))`,
            transition: 'none',
            pointerEvents: 'none',
            userSelect: 'none',
          }}>
            ❤️
          </div>
        </div>
        <div className="pulse-metrics">
          <span style={{ color: pleasure > 0.3 ? '#ff6600' : '#888', fontSize: 10 }}>
            {moodLabel}
          </span>
          <span style={{ color: arousal > 0.6 ? '#ff3366' : '#555', fontSize: 9 }}>
            {arousal > 0.6 ? '🔥 兴奋' : arousal > 0.3 ? '激动' : '平静'}
          </span>
        </div>
      </div>
    </div>
  );
}
