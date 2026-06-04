/** ToolRegistry — 工具注册表 */

import type { ITool } from './types.js';

class ToolRegistryClass {
  private tools = new Map<string, ITool>();

  register(tool: ITool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  list(): ITool[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, action: string, params: Record<string, any>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`未知工具: ${name}`);
    return tool.execute(action, params);
  }
}

export const ToolRegistry = new ToolRegistryClass();
