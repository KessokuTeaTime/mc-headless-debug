#!/usr/bin/env node

import { Command } from 'commander';
import type { AdapterCheck } from '@mc-headless-debug/engine';
import {
  adapterIdSchema,
  rpcMethodSchema
} from '@mc-headless-debug/protocol';
import {
  createAdapterContext,
  loadConfiguredAdapter,
  requireCapabilities,
  resolveScenarioRuntime
} from './adapters.js';
import { readProjectConfig, readScenario } from './config.js';
import { runDoctor } from './doctor.js';
import { initializeAdapter, initializeProject } from './init.js';
import { RpcClient } from './rpc-client.js';
import { runRuntime } from './runtime.js';
import { runScenario } from './scenario-runner.js';

const program = new Command()
  .name('mchd')
  .description('Headless Minecraft client control for developers and coding agents')
  .version('0.1.0');

program.command('doctor')
  .description('Check local headless runtime prerequisites')
  .option('-c, --config <file>', 'configuration file', 'mchd.config.yaml')
  .action(async (options: { config: string }) => {
    let adapterChecks: AdapterCheck[] = [];
    try {
      const config = await readProjectConfig(options.config);
      const adapter = await loadConfiguredAdapter(config);
      if (adapter.doctor) {
        const controller = new AbortController();
        adapterChecks = await adapter.doctor(
          createAdapterContext(config, config.runtime, controller.signal)
        );
      }
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
    const checks = await runDoctor(adapterChecks);
    for (const check of checks) {
      process.stdout.write(`${check.status.padEnd(5)} ${check.name}: ${check.detail}\n`);
    }
    if (checks.some((check) => check.status === 'error')) {
      process.exitCode = 1;
    }
  });

program.command('run')
  .description('Prepare and launch the configured runtime adapter')
  .option('-c, --config <file>', 'configuration file', 'mchd.config.yaml')
  .action(async (options: { config: string }) => {
    const config = await readProjectConfig(options.config);
    process.exitCode = await runRuntime(config);
  });

const adapter = program.command('adapter')
  .description('Inspect configured runtime adapters');

adapter.command('list')
  .option('-c, --config <file>', 'configuration file', 'mchd.config.yaml')
  .action(async (options: { config: string }) => {
    const config = await readProjectConfig(options.config);
    for (const id of Object.keys(config.adapters).sort()) {
      const value = await loadConfiguredAdapter(config, {
        ...config.runtime,
        adapter: id
      });
      process.stdout.write(
        `${value.manifest.id}\t${value.manifest.displayName}\n`
      );
    }
  });

adapter.command('inspect')
  .argument('<id>', 'adapter ID')
  .option('-c, --config <file>', 'configuration file', 'mchd.config.yaml')
  .action(async (id: string, options: { config: string }) => {
    const config = await readProjectConfig(options.config);
    const value = await loadConfiguredAdapter(config, {
      ...config.runtime,
      adapter: id
    });
    process.stdout.write(`${JSON.stringify(value.manifest, null, 2)}\n`);
  });

adapter.command('create')
  .description('Create a new runtime adapter package')
  .argument('<id>', 'adapter ID')
  .requiredOption('--game <id>', 'game family ID')
  .requiredOption('--game-version <version>', 'game version')
  .option('--loader <id>', 'ModLoader or launcher ID')
  .option('-d, --directory <path>', 'adapter directory')
  .action(async (
    id: string,
    options: {
      game: string;
      gameVersion: string;
      loader?: string;
      directory?: string;
    }
  ) => {
    const adapterId = adapterIdSchema.parse(id);
    const directory = options.directory
      ?? `mchd-adapter-${adapterId.replaceAll(/[^a-z0-9]+/g, '-')}`;
    await initializeAdapter(directory, {
      id: adapterId,
      game: options.game,
      gameVersion: options.gameVersion,
      ...(options.loader ? { loader: options.loader } : {})
    });
    process.stdout.write(`Created adapter ${adapterId} in ${directory}\n`);
  });

program.command('init')
  .description('Create an mchd configuration and smoke scenario')
  .argument('[directory]', 'project directory', '.')
  .action(async (directory: string) => {
    await initializeProject(directory);
    process.stdout.write(`Initialized MC Headless Debug in ${directory}\n`);
  });

const scenario = program.command('scenario')
  .description('Validate or run deterministic Minecraft scenarios');

scenario.command('validate')
  .argument('<files...>', 'scenario YAML files')
  .action(async (files: string[]) => {
    for (const file of files) {
      const value = await readScenario(file);
      process.stdout.write(`ok ${file}: ${value.name} (${value.steps.length} steps)\n`);
    }
  });

scenario.command('run')
  .argument('<file>', 'scenario YAML file')
  .option('-c, --config <file>', 'configuration file', 'mchd.config.yaml')
  .action(async (file: string, options: { config: string }) => {
    const config = await readProjectConfig(options.config);
    const value = await readScenario(file);
    const runtime = resolveScenarioRuntime(config, value);
    const adapter = await loadConfiguredAdapter(config, runtime);
    requireCapabilities(adapter, value);
    const client = await RpcClient.fromEndpoint(config.endpoint);
    const status = await client.call('runtime.status');
    if (isRecord(status)
        && typeof status.adapter === 'string'
        && status.adapter !== runtime.adapter) {
      throw new Error(
        `Scenario requires ${runtime.adapter}, but the connected runtime is `
        + status.adapter
      );
    }
    await runScenario(value, client, config.artifacts);
  });

program.command('call')
  .description('Call one bridge method directly')
  .argument('<method>', 'bridge RPC method')
  .argument('[params]', 'JSON object', '{}')
  .option('-c, --config <file>', 'configuration file', 'mchd.config.yaml')
  .action(async (method: string, params: string, options: { config: string }) => {
    const config = await readProjectConfig(options.config);
    const client = await RpcClient.fromEndpoint(config.endpoint);
    const result = await client.call(
      rpcMethodSchema.parse(method),
      JSON.parse(params) as Record<string, unknown>
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

try {
  await program.parseAsync();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mchd: ${message}\n`);
  process.exitCode = 1;
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
