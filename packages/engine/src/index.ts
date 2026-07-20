import {
  adapterManifestSchema,
  type AdapterManifest,
  type Endpoint,
  type RuntimeConfig
} from '@mc-headless-debug/protocol';
import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ENGINE_API_VERSION = 1;

export interface AdapterContext {
  projectRoot: string;
  stateDirectory: string;
  artifactsDirectory: string;
  runtime: RuntimeConfig;
  endpoint: Endpoint;
  signal: AbortSignal;
}

export interface AdapterDetection {
  score: number;
  reason: string;
}

export interface AdapterCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  detail: string;
}

export interface PreparedRuntime {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  endpoint: Endpoint;
}

export interface RuntimeProcess {
  pid: number;
  exited: Promise<number>;
  stop(): Promise<void>;
}

export interface RuntimeAdapter {
  manifest: AdapterManifest;
  doctor?(context: AdapterContext): Promise<AdapterCheck[]>;
  detect(context: AdapterContext): Promise<AdapterDetection>;
  prepare(context: AdapterContext): Promise<PreparedRuntime>;
  launch(context: AdapterContext, runtime: PreparedRuntime): Promise<RuntimeProcess>;
}

export interface AdapterModule {
  createAdapter(): RuntimeAdapter | Promise<RuntimeAdapter>;
}

export class AdapterRegistry {
  private readonly adapters = new Map<string, RuntimeAdapter>();

  public register(adapter: RuntimeAdapter): void {
    if (this.adapters.has(adapter.manifest.id)) {
      throw new Error(`Adapter already registered: ${adapter.manifest.id}`);
    }
    this.adapters.set(adapter.manifest.id, adapter);
  }

  public require(id: string): RuntimeAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) {
      throw new Error(`Adapter is not installed: ${id}`);
    }
    return adapter;
  }

  public list(): RuntimeAdapter[] {
    return [...this.adapters.values()]
      .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  }
}

export async function loadAdapter(
  specifier: string,
  projectRoot = process.cwd()
): Promise<RuntimeAdapter> {
  const resolvedSpecifier = resolveAdapterSpecifier(specifier, projectRoot);
  const module = await import(resolvedSpecifier) as Partial<AdapterModule>;
  if (typeof module.createAdapter !== 'function') {
    throw new Error(`Adapter module does not export createAdapter(): ${specifier}`);
  }
  const adapter = await module.createAdapter();
  adapterManifestSchema.parse(adapter.manifest);
  if (adapter.manifest.engineApi !== ENGINE_API_VERSION) {
    throw new Error(
      `Adapter ${adapter.manifest.id} requires engine API `
      + `${adapter.manifest.engineApi}; this engine provides ${ENGINE_API_VERSION}`
    );
  }
  return adapter;
}

function resolveAdapterSpecifier(specifier: string, projectRoot: string): string {
  if (specifier.startsWith('.') || isAbsolute(specifier)) {
    return pathToFileURL(resolve(projectRoot, specifier)).href;
  }
  const require = createRequire(resolve(projectRoot, 'package.json'));
  return pathToFileURL(require.resolve(specifier)).href;
}
