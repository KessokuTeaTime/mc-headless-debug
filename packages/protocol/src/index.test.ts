import { describe, expect, it } from 'vitest';
import { projectConfigSchema, scenarioSchema } from './index.js';

describe('projectConfigSchema', () => {
  it('applies deterministic defaults', () => {
    const config = projectConfigSchema.parse({
      schemaVersion: 1,
      runtime: {
        adapter: 'minecraft-java/26.2/fabric'
      },
      endpoint: {}
    });

    expect(config.runtime).toEqual({
      adapter: 'minecraft-java/26.2/fabric',
      backend: 'native',
      options: {}
    });
    expect(config.endpoint.port).toBe(25570);
    expect(config.adapters).toEqual({});
  });
});

describe('RPC timeouts', () => {
  it('applies defaults and accepts explicit long-running calls', () => {
    const defaultStep = scenarioSchema.parse({
      schemaVersion: 1,
      name: 'default timeout',
      steps: [{ call: 'world.create' }]
    }).steps[0];
    const longStep = scenarioSchema.parse({
      schemaVersion: 1,
      name: 'long timeout',
      steps: [{ call: 'world.create', timeoutMs: 600_000 }]
    }).steps[0];

    expect(defaultStep?.timeoutMs).toBe(30_000);
    expect(longStep?.timeoutMs).toBe(600_000);
    expect(() => scenarioSchema.parse({
      schemaVersion: 1,
      name: 'invalid timeout',
      steps: [{ call: 'world.create', timeoutMs: 600_001 }]
    })).toThrow();
  });
});

describe('scenarioSchema', () => {
  it('rejects unknown bridge calls', () => {
    expect(() => scenarioSchema.parse({
      schemaVersion: 1,
      name: 'bad scenario',
      steps: [{ call: 'invalid' }]
    })).toThrow();
  });

  it('accepts namespaced adapter calls', () => {
    const scenario = scenarioSchema.parse({
      schemaVersion: 1,
      name: 'adapter extension',
      steps: [{ call: 'neoforge.registry.dump' }]
    });
    expect(scenario.steps[0]?.call).toBe('neoforge.registry.dump');
  });
});
