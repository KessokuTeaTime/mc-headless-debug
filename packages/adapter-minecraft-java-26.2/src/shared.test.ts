import { describe, expect, it } from 'vitest';
import { createMinecraft262Adapter } from './shared.js';

describe('Minecraft 26.2 adapters', () => {
  it.each(['fabric', 'neoforge'] as const)(
    'declares capabilities without leaking into the engine for %s',
    (loader) => {
      const adapter = createMinecraft262Adapter(loader);
      expect(adapter.manifest.id).toBe(`minecraft-java/26.2/${loader}`);
      expect(adapter.manifest.engineApi).toBe(1);
      expect(adapter.manifest.capabilities).toContain('gui.inspect');
      expect(adapter.manifest.capabilities).toContain('entity.spawn');
    }
  );
});
