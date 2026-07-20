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
