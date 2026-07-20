import { resolve } from 'node:path';
import { loadAdapter, type AdapterContext, type RuntimeAdapter } from '@mc-headless-debug/engine';
import type {
  ProjectConfig,
  RuntimeConfig,
  Scenario
} from '@mc-headless-debug/protocol';

export async function loadConfiguredAdapter(
  config: ProjectConfig,
  runtime: RuntimeConfig = config.runtime
): Promise<RuntimeAdapter> {
  const specifier = config.adapters[runtime.adapter];
  if (!specifier) {
    throw new Error(
      `Adapter ${runtime.adapter} is not configured. `
      + 'Add its package or file path under adapters in mchd.config.yaml.'
    );
  }
  const adapter = await loadAdapter(specifier, resolve(config.projectRoot));
  if (adapter.manifest.id !== runtime.adapter) {
    throw new Error(
      `Adapter ID mismatch: config requested ${runtime.adapter}, `
      + `module provided ${adapter.manifest.id}`
    );
  }
  return adapter;
}

export function resolveScenarioRuntime(
  config: ProjectConfig,
  scenario: Scenario
): RuntimeConfig {
  return {
    adapter: scenario.runtime?.adapter ?? config.runtime.adapter,
    backend: scenario.runtime?.backend ?? config.runtime.backend,
    options: {
      ...config.runtime.options,
      ...scenario.runtime?.options
    }
  };
}

export function createAdapterContext(
  config: ProjectConfig,
  runtime: RuntimeConfig,
  signal: AbortSignal
): AdapterContext {
  const projectRoot = config.projectRoot;
  return {
    projectRoot,
    stateDirectory: resolve(projectRoot, '.mchd'),
    artifactsDirectory: config.artifacts,
    runtime,
    endpoint: config.endpoint,
    signal
  };
}

export function requireCapabilities(
  adapter: RuntimeAdapter,
  scenario: Scenario
): void {
  const available = new Set(adapter.manifest.capabilities);
  const missing = [...new Set(
    scenario.steps
      .map((step) => step.call)
      .filter((method) => !available.has(method) && !available.has('*'))
  )];
  if (missing.length > 0) {
    throw new Error(
      `Adapter ${adapter.manifest.id} is missing scenario capabilities: `
      + missing.join(', ')
    );
  }
}
