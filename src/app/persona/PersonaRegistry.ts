/**
 * PersonaRegistry — 角色注册表
 *
 * 全局单例，管理所有可用角色的注册与切换。
 */
import type { IPersona } from './types.js';

class PersonaRegistryClass {
  private personas = new Map<string, IPersona>();
  private activeId = 'yuyao';

  register(persona: IPersona): void {
    this.personas.set(persona.id, persona);
  }

  get(id: string): IPersona | undefined {
    return this.personas.get(id);
  }

  setActive(id: string): boolean {
    if (!this.personas.has(id)) return false;
    this.activeId = id;
    return true;
  }

  getActive(): IPersona | undefined {
    return this.personas.get(this.activeId) ?? this.personas.values().next().value;
  }

  list(): IPersona[] {
    return Array.from(this.personas.values());
  }
}

export const PersonaRegistry = new PersonaRegistryClass();
