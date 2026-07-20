import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeAdapter } from './index.js';
import { AdapterRegistry, loadAdapter } from './index.js';

const adapter: RuntimeAdapter = {
  manifest: {
    schemaVersion: 1,
    id: 'example/1.0/test-loader',
    displayName: 'Example adapter',
    engineApi: 1,
    target: {
      game: 'example',
      gameVersion: '1.0',
      loader: 'test-loader'
    },
    capabilities: [],
    requirements: {}
  },
  async detect() {
    return { score: 1, reason: 'test' };
  },
  async prepare() {
    throw new Error('not used');
  },
  async launch() {
    throw new Error('not used');
  }
};

describe('AdapterRegistry', () => {
  it('keeps the engine independent of adapter IDs', () => {
    const registry = new AdapterRegistry();
    registry.register(adapter);
    expect(registry.require('example/1.0/test-loader')).toBe(adapter);
  });

  it('loads a project-local adapter module without knowing its target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mchd-adapter-'));
    await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
    await writeFile(join(directory, 'adapter.mjs'), `
      export function createAdapter() {
        return {
          manifest: {
            schemaVersion: 1,
            id: 'custom-game/9/custom-loader',
            displayName: 'Custom game adapter',
            engineApi: 1,
            target: {
              game: 'custom-game',
              gameVersion: '9',
              loader: 'custom-loader'
            },
            capabilities: [],
            requirements: {}
          },
          detect: async () => ({ score: 1, reason: 'test' }),
          prepare: async () => { throw new Error('not used'); },
          launch: async () => { throw new Error('not used'); }
        };
      }
    `);

    try {
      const loaded = await loadAdapter('./adapter.mjs', directory);
      expect(loaded.manifest.id).toBe('custom-game/9/custom-loader');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
