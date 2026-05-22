import type { AIProfile } from './types.js';
import { generateUniqueId, validateProfile } from './profile-utils.js';

export interface ConfigBackend {
  get<T>(key: string): T | undefined;
  update<T>(key: string, value: T): Promise<void>;
}

const PROFILES_KEY = 'profiles';
const ACTIVE_KEY = 'activeProfileId';

export class ProfileStore {
  constructor(private readonly cfg: ConfigBackend) {}

  list(): AIProfile[] {
    return this.cfg.get<AIProfile[]>(PROFILES_KEY) ?? [];
  }

  getActiveId(): string {
    return this.cfg.get<string>(ACTIVE_KEY) ?? '';
  }

  getActive(): AIProfile | undefined {
    const id = this.getActiveId();
    return this.list().find((p) => p.id === id);
  }

  async setActive(id: string): Promise<void> {
    await this.cfg.update(ACTIVE_KEY, id);
  }

  async add(draft: Partial<AIProfile>): Promise<{ profile: AIProfile; warnings: string[] }> {
    const { profile, validation } = validateProfile(draft);
    if (!profile) {
      throw new Error('profile invalid: ' + validation.errors.join('; '));
    }
    const list = this.list();
    profile.id = draft.id?.trim() || generateUniqueId(profile.label, list.map((p) => p.id));
    if (list.some((p) => p.id === profile.id)) {
      throw new Error(`profile id 冲突: ${profile.id}`);
    }
    const next = [...list, profile];
    await this.cfg.update(PROFILES_KEY, next);
    if (this.getActiveId().length === 0) {
      await this.setActive(profile.id);
    }
    return { profile, warnings: validation.warnings };
  }

  async update(id: string, patch: Partial<AIProfile>): Promise<{ profile: AIProfile; warnings: string[] }> {
    const list = this.list();
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`profile not found: ${id}`);
    const merged = { ...list[idx], ...patch, id };
    const { profile, validation } = validateProfile(merged);
    if (!profile) throw new Error('profile invalid: ' + validation.errors.join('; '));
    const next = [...list];
    next[idx] = profile;
    await this.cfg.update(PROFILES_KEY, next);
    return { profile, warnings: validation.warnings };
  }

  async remove(id: string): Promise<{ newActive: string }> {
    const list = this.list();
    const next = list.filter((p) => p.id !== id);
    await this.cfg.update(PROFILES_KEY, next);
    let activeId = this.getActiveId();
    if (activeId === id) {
      activeId = next[0]?.id ?? '';
      await this.setActive(activeId);
    }
    return { newActive: activeId };
  }
}
