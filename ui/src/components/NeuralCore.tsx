/**
 * NeuralCore — "会呼吸的神经拓扑图"
 *
 * 核心 3D 场景组件。职责分离：
 * - NeuralCore（外层）：Canvas 配置
 * - NeuralScene（内层）：所有 R3F hooks 与 3D 逻辑
 */
import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useNeuralStore } from '../store/neuralStore';
import { useChatStore } from '../store/chatStore';
import { GROUP_COLORS } from '../types/neural';

/* ============================================================
 *  Inner Scene
 * ============================================================ */
function NeuralScene() {
  const neuralData = useNeuralStore((s) => s.neuralData);
  const setFps = useNeuralStore((s) => s.setFps);
  const mousePosition = useNeuralStore((s) => s.mousePosition);
  const mouseInView = useNeuralStore((s) => s.mouseInView);
  const interactionRadius = useNeuralStore((s) => s.interactionRadius);

  // 🔥 Read emotional intensity from chat
  const m3Data = useChatStore((s) => (s as any).m3Data || null);
  const pleasure = m3Data?.quadrant1?.find((d: any) => d.key === 'pleasure')?.value || 0;
  const arousal = m3Data?.quadrant1?.find((d: any) => d.key === 'arousal')?.value || 0;
  const intimacy = m3Data?.quadrant3?.find((d: any) => d.key === 'intimacy')?.value || 0;
  const ecstasy = m3Data?.quadrant4?.find((d: any) => d.key === 'ecstasy')?.value || 0;
  const exciteLevel = Math.min(1, Math.abs(pleasure) * 0.6 + arousal * 0.5 + intimacy * 0.5 + ecstasy * 0.6);
  const warmth = Math.min(1, (Math.max(0, pleasure) + intimacy + ecstasy) / 1.5);
  const warmMix = new THREE.Color(1, 0.4 + warmth * 0.3, 0.15 + (1 - warmth) * 0.15);

  const { viewport } = useThree();

  // ---- 粒子状态 ----
  const nodes = useMemo(() => neuralData?.nodes ?? [], [neuralData]);
  const connections = useMemo(() => neuralData?.connections ?? [], [neuralData]);

  // 每个粒子的运行时状态（位置、速度、相位等）
  const particleData = useRef<{
    positions: Float32Array;
    velocities: Float32Array;
    basePositions: Float32Array;
    phases: Float32Array;
    groups: Uint8Array;
    energies: Float32Array;
  } | null>(null);

  // ---- BufferGeometry refs ----
  const particlesRef = useRef<THREE.Points>(null);
  const linesRef = useRef<THREE.LineSegments>(null);

  // 连接线端点索引
  const lineIndices = useMemo(() => {
    const idx: number[] = [];
    if (!neuralData) return new Uint16Array();
    for (const conn of neuralData.connections) {
      idx.push(conn.source, conn.target);
    }
    return new Uint16Array(idx);
  }, [neuralData]);

  // 连接强度数组
  const lineStrengths = useMemo(() => {
    if (!neuralData) return new Float32Array();
    return new Float32Array(neuralData.connections.map((c) => c.strength));
  }, [neuralData]);

  // ---- 初始化粒子数据 ----
  useEffect(() => {
    if (nodes.length === 0) return;

    const count = nodes.length;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const basePositions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const groups = new Uint8Array(count);
    const energies = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const n = nodes[i];
      basePositions[i * 3] = n.x;
      basePositions[i * 3 + 1] = n.y;
      basePositions[i * 3 + 2] = n.z;
      positions[i * 3] = n.x;
      positions[i * 3 + 1] = n.y;
      positions[i * 3 + 2] = n.z;
      velocities[i * 3] = 0;
      velocities[i * 3 + 1] = 0;
      velocities[i * 3 + 2] = 0;
      phases[i] = Math.random() * Math.PI * 2;
      groups[i] = n.group;
      energies[i] = n.energy;
    }

    particleData.current = { positions, velocities, basePositions, phases, groups, energies };

    // 更新 Points 几何
    if (particlesRef.current) {
      const geom = particlesRef.current.geometry;
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('size', new THREE.BufferAttribute(new Float32Array(count).fill(1), 1));
      geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    }
  }, [nodes]);

  // ---- 每帧更新 ----
  const frameCount = useRef(0);
  const lastFpsTime = useRef(0);

  useFrame(({ clock, mouse }) => {
    const pd = particleData.current;
    const points = particlesRef.current;
    const lines = linesRef.current;
    if (!pd || !points || !lines) return;

    const count = pd.positions.length / 3;
    const t = clock.getElapsedTime();
    const mouse3D = new THREE.Vector3(
      (mousePosition.x / window.innerWidth) * 2 - 1,
      -(mousePosition.y / window.innerHeight) * 2 + 1,
      0,
    );
    // 映射到 3D 空间
    mouse3D.x *= viewport.width / 2;
    mouse3D.y *= viewport.height / 2;

    const posAttr = points.geometry.attributes.position as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;
    const colorAttr = points.geometry.attributes.color as THREE.BufferAttribute;
    const colorArray = colorAttr.array as Float32Array;

    // 获取连接线的 position attribute
    const linePosAttr = lines.geometry.attributes.position as THREE.BufferAttribute;
    const linePosArray = linePosAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const phase = pd.phases[i];
      const energy = pd.energies[i];

      // --- 呼吸效果：正弦波驱动位置偏移和缩放 ---
      const breathSpeed = 0.15 + exciteLevel * 1.2;
      const breath = 1 + (0.04 + exciteLevel * 0.08) * Math.sin(t * breathSpeed + phase) * (0.5 + energy * 0.5);

      // 目标位置 = 基线位置 * 呼吸因子
      const targetX = pd.basePositions[i3] * breath;
      const targetY = pd.basePositions[i3 + 1] * breath;
      const targetZ = pd.basePositions[i3 + 2] * breath;

      // --- 鼠标交互：附近粒子被排斥 ---
      let forceX = 0, forceY = 0, forceZ = 0;
      if (mouseInView) {
        const dx = posArray[i3] - mouse3D.x;
        const dy = posArray[i3 + 1] - mouse3D.y;
        const dz = posArray[i3 + 2] - mouse3D.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < interactionRadius && dist > 0.01) {
          const force = (1 - dist / interactionRadius) * 0.5;
          forceX = (dx / dist) * force;
          forceY = (dy / dist) * force;
          forceZ = (dz / dist) * force;
        }
      }

      // --- 弹性动力学 ---
      const damping = 0.92 - exciteLevel * 0.04;
      const spring = 0.04 + exciteLevel * 0.08;
      pd.velocities[i3] = (pd.velocities[i3] + (targetX - posArray[i3]) * spring + forceX) * damping;
      pd.velocities[i3 + 1] = (pd.velocities[i3 + 1] + (targetY - posArray[i3 + 1]) * spring + forceY) * damping;
      pd.velocities[i3 + 2] = (pd.velocities[i3 + 2] + (targetZ - posArray[i3 + 2]) * spring + forceZ) * damping;

      posArray[i3] += pd.velocities[i3];
      posArray[i3 + 1] += pd.velocities[i3 + 1];
      posArray[i3 + 2] += pd.velocities[i3 + 2];

      // --- 粒子颜色：随能量和呼吸变化 ---
      const group = pd.groups[i];
      const hexColor = new THREE.Color(GROUP_COLORS[group] || '#00ffff');
      const brightness = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(t * (0.15 + exciteLevel * 0.5) + phase));
      if (warmth > 0.1) {
        const warm = new THREE.Color(warmMix).lerp(hexColor, 1 - warmth);
        colorArray[i3] = warm.r * brightness;
        colorArray[i3 + 1] = warm.g * brightness;
        colorArray[i3 + 2] = warm.b * brightness;
      } else {
        colorArray[i3] = hexColor.r * brightness;
        colorArray[i3 + 1] = hexColor.g * brightness;
        colorArray[i3 + 2] = hexColor.b * brightness;
      }
    }

    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;

    // --- 更新连接线 ---
    if (lineIndices.length > 0) {
      for (let i = 0; i < lineIndices.length; i += 2) {
        const si = lineIndices[i] * 3;
        const ti = lineIndices[i + 1] * 3;
        const li = i * 3;
        linePosArray[li] = posArray[si];
        linePosArray[li + 1] = posArray[si + 1];
        linePosArray[li + 2] = posArray[si + 2];
        linePosArray[li + 3] = posArray[ti];
        linePosArray[li + 4] = posArray[ti + 1];
        linePosArray[li + 5] = posArray[ti + 2];
      }
      linePosAttr.needsUpdate = true;
    }

    // --- FPS 统计 ---
    frameCount.current++;
    if (t - lastFpsTime.current >= 1) {
      setFps(frameCount.current);
      frameCount.current = 0;
      lastFpsTime.current = t;
    }
  });

  // ---- 如果没有数据，显示占位 ----
  if (nodes.length === 0) {
    return (
      <mesh>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial color="#00ffff" wireframe />
      </mesh>
    );
  }

  return (
    <group>
      {/* 粒子系统 */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={nodes.length}
            array={new Float32Array(nodes.length * 3)}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-size"
            count={nodes.length}
            array={new Float32Array(nodes.length).fill(1)}
            itemSize={1}
          />
          <bufferAttribute
            attach="attributes-color"
            count={nodes.length}
            array={new Float32Array(nodes.length * 3)}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.25}
          vertexColors
          transparent
          opacity={0.9}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* 连接线 */}
      <lineSegments ref={linesRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={lineIndices.length}
            array={new Float32Array(lineIndices.length * 3)}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={new THREE.Color(0, 0.5 + warmth * 0.5, 0.8 - warmth * 0.5)}
          transparent
          opacity={0.1 + exciteLevel * 0.2}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}

/* ============================================================
 *  Exported Canvas Wrapper
 * ============================================================ */
export default function NeuralCore() {
  return (
    <Canvas
      camera={{ position: [0, 2, 18], fov: 50 }}
      dpr={[1, 2]} // 自适应 DPR 保性能
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
        depth: true,
      }}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    >
      {/* 环境背景色匹配 #050505 */}
      <color attach="background" args={['#050505']} />

      {/* 微弱的环境光增强立体感 */}
      <ambientLight intensity={0.2} />

      <NeuralScene />
    </Canvas>
  );
}
