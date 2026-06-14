/**
 * config.ts 结构性守卫测试
 *
 * 锁定配置结构，防止误删误改关键参数。
 */
import { describe, it, expect } from 'vitest';
import { config } from '../config.js';

describe('[Config守卫] 顶层结构', () => {
  it('config 是对象', () => { expect(typeof config).toBe('object'); });
  it('有 paths / m1-m9 / maintenance / composer / bionic / tts', () => {
    const keys = Object.keys(config);
    expect(keys).toContain('paths');
    for (let i = 1; i <= 9; i++) expect(keys).toContain(`m${i}`);
    expect(keys).toContain('maintenance');
    expect(keys).toContain('composer');
    expect(keys).toContain('bionic');
    expect(keys).toContain('tts');
  });
});

describe('[Config守卫] M1-M9 参数完整性', () => {
  it('m1 有 taxonomyPath', () => { expect(typeof config.m1.taxonomyPath).toBe('string'); });
  it('m2 有 dbName/maxRecallCandidates', () => {
    expect(typeof config.m2.dbName).toBe('string');
    expect(config.m2.maxRecallCandidates).toBeGreaterThan(0);
  });
  it('m5 有 maxHistoryTurns = 200', () => { expect(config.m5.maxHistoryTurns).toBe(200); });
  it('m7 有 batchThreshold = 10', () => { expect(config.m7.batchThreshold).toBe(10); });
  it('m9 有 graduateCycleMax = 3', () => { expect(config.m9.graduateCycleMax).toBe(3); });
  it('m9 有 forceGraduateCycle = 6', () => { expect(config.m9.forceGraduateCycle).toBe(6); });
});

describe('[Config守卫] 服务 API 地址', () => {
  it('composer.apiUrl 含 8100', () => { expect(config.composer.apiUrl).toContain('8100'); });
  it('bionic.apiUrl 含 7200', () => { expect(config.bionic.apiUrl).toContain('7200'); });
  it('tts.apiUrl 含 8765', () => { expect(config.tts.apiUrl).toContain('8765'); });
});
