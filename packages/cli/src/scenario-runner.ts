import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Scenario } from '@mc-headless-debug/protocol';
import { RpcClient } from './rpc-client.js';

export async function runScenario(
  scenario: Scenario,
  client: RpcClient,
  artifacts: string
): Promise<void> {
  const outputDirectory = resolve(artifacts, scenario.name.replaceAll(/[^a-z0-9-]+/gi, '-'));
  await mkdir(outputDirectory, { recursive: true });

  for (const [index, step] of scenario.steps.entries()) {
    const result = await client.call(step.call, step.with, step.timeoutMs);
    if (step.saveAs) {
      await writeFile(
        resolve(outputDirectory, `${step.saveAs}.json`),
        `${JSON.stringify(result, null, 2)}\n`
      );
    }
    process.stdout.write(
      `${String(index + 1).padStart(2, '0')} ${step.name ?? step.call}\n`
    );
  }
}
