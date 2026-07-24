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
      expect(adapter.manifest.capabilities).toContain('runtime.lifecycle');
      expect(adapter.manifest.capabilities).toContain('wait.frames');
      expect(adapter.manifest.capabilities).toContain('input.dispatch');
      expect(adapter.manifest.capabilities).toContain('input.state');
      expect(adapter.manifest.capabilities).toContain('world.inspect');
      expect(adapter.manifest.capabilities).toContain('block.inspect');
      expect(adapter.manifest.capabilities).toContain('player.get');
      expect(adapter.manifest.capabilities).toContain('player.inventory');
      expect(adapter.manifest.capabilities).toContain('window.resize');
    }
  );
});
