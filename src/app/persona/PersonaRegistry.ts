/**
 * PersonaRegistry — 角色注册表
 *
 * 全局单例，管理所有可用角色的注册与切换。
 */
import type { IPersona } from './types.js';

class PersonaRegistryClass {
  private personas = new Map<string, IPersona>();
  private activeId = 'yuyao';
  private switchListeners: Array<(personaId: string) => void> = [];

  register(persona: IPersona): void {
    this.personas.set(persona.id, persona);
  }

  get(id: string): IPersona | undefined {
    return this.personas.get(id);
  }

  setActive(id: string): boolean {
    if (!this.personas.has(id)) return false;
    this.activeId = id;
    // 广播角色切换事件
    for (const cb of this.switchListeners) { try { cb(id); } catch (e) { console.warn('[Persona] 监听器失败:', e); } }
    return true;
  }

  /** P0: 注册角色切换监听 */
  onSwitch(callback: (personaId: string) => void): void {
    this.switchListeners.push(callback);
  }

  getActive(): IPersona | undefined {
    return this.personas.get(this.activeId) ?? this.personas.values().next().value;
  }

  list(): IPersona[] {
    return Array.from(this.personas.values());
  }
}

export const PersonaRegistry = new PersonaRegistryClass();
