import type { ProjectConfig, RuntimeConfig } from '@mc-headless-debug/protocol';
import {
  createAdapterContext,
  loadConfiguredAdapter
} from './adapters.js';

export async function runRuntime(
  config: ProjectConfig,
  runtime: RuntimeConfig = config.runtime
): Promise<number> {
  const controller = new AbortController();
  const adapter = await loadConfiguredAdapter(config, runtime);
  const context = createAdapterContext(config, runtime, controller.signal);
  const detection = await adapter.detect(context);
  if (detection.score <= 0) {
    throw new Error(
      `Adapter ${adapter.manifest.id} cannot run this project: ${detection.reason}`
    );
  }

  const prepared = await adapter.prepare(context);
  const process = await adapter.launch(context, prepared);

  const stop = async () => {
    controller.abort();
    await process.stop();
  };
  globalThis.process.once('SIGINT', stop);
  globalThis.process.once('SIGTERM', stop);
  try {
    return await process.exited;
  } finally {
    globalThis.process.off('SIGINT', stop);
    globalThis.process.off('SIGTERM', stop);
  }
}
