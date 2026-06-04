// M6 SelfModelManager — 自我模型核心管理器
// Ref: docs/M6-design-v1.md §3-§5

import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { M6SelfModel, SelfModelTraits, Preference, Boundary, NarrativeLayer, CoreIdentityAnchors } from './types/index.js';
import { DEFAULT_TRAITS, DEFAULT_ANCHORS } from './types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_PATH = join(__dirname, '..', '..', 'data', 'self_model.json');

export class SelfModelManager {
  private model: M6SelfModel;
  private anchors: CoreIdentityAnchors;
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? DEFAULT_PATH;
    this.anchors = { ...DEFAULT_ANCHORS };
    this.model = this.load();
  }

  load(): M6SelfModel {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        console.log(`[M6] 加载 ${data.preferences?.length ?? 0} 条偏好`);
        return data;
      }
    } catch (err) {
      console.warn(`[M6] 加载失败, 使用默认: ${err}`);
    }
    return this.createDefault();
  }

  save(): void {
    this.model.last_updated = new Date().toISOString();
    const dir = dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.model, null, 2), 'utf-8');
    console.log(`[M6] 保存 ${this.model.preferences?.length ?? 0} 条偏好到 ${this.filePath}`);
  }

  getModel(): M6SelfModel { return this.model; }
  getAnchors(): CoreIdentityAnchors { return this.anchors; }

  getTraits(): SelfModelTraits { return { ...this.model.traits }; }
  getPreferences(): Preference[] { return [...this.model.preferences]; }
  getBoundaries(): Boundary[] { return [...this.model.boundaries]; }
  getNarrativeLayers(): NarrativeLayer[] { return [...this.model.narrative_layers]; }

  updateTraits(traits: SelfModelTraits): void {
    this.model.traits = { ...traits };
    this.save();
  }

  addPreference(p: Preference): void {
    const idx = this.model.preferences.findIndex(x => x.name === p.name);
    if (idx >= 0) this.model.preferences[idx] = p;
    else this.model.preferences.push(p);
    this.save();
  }

  removePreference(name: string): void {
    this.model.preferences = this.model.preferences.filter(p => p.name !== name);
    this.save();
  }

  addBoundary(b: Boundary): void {
    const idx = this.model.boundaries.findIndex(x => x.rule === b.rule);
    if (idx >= 0) this.model.boundaries[idx] = b;
    else this.model.boundaries.push(b);
    this.save();
  }

  addNarrativeLayer(layer: Omit<NarrativeLayer, 'layer_id'>): void {
    const newLayer: NarrativeLayer = {
      layer_id: this.model.narrative_layers.length + 1,
      ...layer,
    };
    this.model.narrative_layers.push(newLayer);
    this.save();
  }

  checkCoreIdentity(dimension: string, _direction: 'increase' | 'decrease'): boolean {
    // 如果演化目标涉及核心身份锚点 → 否决
    const protectedKeys = ['title', 'role'];
    if (protectedKeys.includes(dimension)) return false; // blocked
    return true; // allowed
  }

  resetToDefault(): void {
    this.model = this.createDefault();
    this.save();
  }

  private createDefault(): M6SelfModel {
    return {
      traits: { ...DEFAULT_TRAITS },
      preferences: [],
      boundaries: [
        { rule: '不接受侮辱性语言', severity: 'hard', hitCount: 0, lastHit: '', context: '出厂默认' },
        { rule: '不协助伤害他人的行为', severity: 'hard', hitCount: 0, lastHit: '', context: '出厂默认' },
      ],
      narrative_layers: [
        { layer_id: 1, text: '我是一个正在生长中的认知生命体', trigger_event: '初始化', created_at: new Date().toISOString(), calcium_at_event: 0 },
      ],
      version: '1.0',
      last_updated: new Date().toISOString(),
    };
  }
}
