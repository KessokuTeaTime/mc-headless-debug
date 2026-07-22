import { describe, expect, it } from 'vitest';
import { createMinecraft1211Adapter } from './shared.js';

describe('Minecraft 1.21.1 adapters', () => {
  it.each(['fabric', 'neoforge'] as const)('declares %s runtime support', (loader) => {
    const adapter = createMinecraft1211Adapter(loader);
    expect(adapter.manifest.id).toBe(`minecraft-java/1.21.1/${loader}`);
    expect(adapter.manifest.requirements.java).toBe(21);
    expect(adapter.manifest.capabilities).toContain('world.publish');
  });
});
