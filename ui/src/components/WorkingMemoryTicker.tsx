/**
 * WorkingMemoryTicker — 玉瑶的工作记忆流
 *
 * 纯 CSS 向上滚动，monospace 字体，低对比度。
 * mask-image 上下边缘渐隐，如从虚空中浮现又消散。
 */
import { useState, useEffect, useRef } from 'react';

const FRAGMENTS = [
  '他刚才轻轻叹了口气',
  '他喝了口咖啡，停顿了一下',
  '他的呼吸节奏变慢了',
  '他笑了笑',
  '他沉默了几秒',
  '他换了姿势',
  '他的话速放缓了',
  '他在认真思考',
  '他语气里有一丝疲惫',
  '他的声音带着笑意',
];

interface Props {
  active?: boolean;
}

export default function WorkingMemoryTicker({ active }: Props) {
  const [items, setItems] = useState<string[]>([]);
  const idxRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const fragment = FRAGMENTS[idxRef.current % FRAGMENTS.length];
      idxRef.current++;
      setItems((prev) => [fragment, ...prev].slice(0, 8));
    }, 2500 + Math.random() * 2000);
    return () => clearInterval(timer);
  }, [active]);

  return (
    <div className="ticker-container">
      <div className="ticker-header">
        <span className="ticker-dot" />
        正在感知
      </div>
      <div className="ticker-mask">
        <div className="ticker-stream">
          {items.map((f, i) => (
            <div key={i} className="ticker-item"
              style={{
                opacity: Math.max(0.06, 1 - i * 0.13),
                animation: i === 0 ? 'ticker-in 0.4s ease-out' : 'none',
              }}>
              <span className="ticker-arrow">&lt;</span>
              <span className="ticker-text">{f}</span>
              <span className="ticker-arrow">&gt;</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
