import { spawn } from 'node:child_process';
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { createConnection } from 'node:net';
import { basename as pathBasename, dirname, join, resolve } from 'node:path';
import yauzl from 'yauzl';
import {
  resolveHostBackend,
  type BackendOptions
} from './host-backends.js';
import type {
  AdapterContext,
  PreparedRuntime,
  RuntimeAdapter,
  RuntimeProcess
} from '@mc-headless-debug/engine';

const HMC_VERSION = '2.10.0';
const HMC_FILENAME = `headlessmc-launcher-${HMC_VERSION}.jar`;
const HMC_URL = `https://github.com/3arthqu4ke/headlessmc/releases/download/${HMC_VERSION}/${HMC_FILENAME}`;
export const MINECRAFT_CAPABILITIES = [
  'runtime.status',
  'runtime.stop',
  'world.create',
  'world.configure',
  'world.publish',
  'command.execute',
  'player.get',
  'player.list',
  'player.configure',
  'player.input',
  'entity.query',
  'entity.spawn',
  'entity.configure',
  'entity.remove',
  'gui.inspect',
  'gui.open',
  'gui.click',
  'gui.key',
  'gui.type',
  'screenshot.capture',
  'wait.ticks',
  'wait.until'
];

export interface MinecraftLoaderSpec {
  id: string;
  displayName: string;
  version: string;
  installCommand: string;
  installerUrl?: string;
  profileRegex: string;
  metadata: string;
  bridgeArtifact: string;
  bridgeTask: string;
}

export interface MinecraftAdapterSpec {
  gameVersion: string;
  javaVersion: number;
  packageDirectory: string;
  bridgeSourceDirectory: string;
  loaders: Record<string, MinecraftLoaderSpec>;
}

interface AdapterOptions extends BackendOptions {
  build?: boolean;
  bridgeOnly?: boolean;
  buildCommand?: string[];
  mods?: string[];
  username?: string;
  server?: string;
}

export function createMinecraftJavaAdapter(
  spec: MinecraftAdapterSpec,
  loaderId: string
): RuntimeAdapter {
  const loader = spec.loaders[loaderId];
  if (!loader) {
    throw new Error(`Unknown Minecraft ${spec.gameVersion} loader: ${loaderId}`);
  }
  return {
    manifest: {
      schemaVersion: 1,
      id: `minecraft-java/${spec.gameVersion}/${loader.id}`,
      displayName: `Minecraft Java ${spec.gameVersion} + ${loader.displayName}`,
      engineApi: 1,
      target: {
        game: 'minecraft-java',
        gameVersion: spec.gameVersion,
        loader: loader.id,
        loaderVersion: loader.version
      },
      capabilities: MINECRAFT_CAPABILITIES,
      requirements: {
        java: spec.javaVersion,
        display: 'xvfb-or-container'
      }
    },
    async doctor(context) {
      return doctor(context, spec.javaVersion);
    },
    async detect(context) {
      const options = readOptions(context);
      if (options.bridgeOnly) {
        return { score: 100, reason: 'Bridge-only runtime is configured' };
      }
      if (options.mods && options.mods.length > 0) {
        return { score: 100, reason: 'Explicit mod artifacts are configured' };
      }
      const gradle = join(context.projectRoot, gradleExecutable());
      return await exists(gradle)
        ? { score: 80, reason: 'Gradle wrapper found' }
        : { score: 0, reason: 'No mod artifacts or Gradle wrapper found' };
    },
    async prepare(context) {
      return prepare(context, spec, loader);
    },
    async launch(context, runtime) {
      return launch(context, runtime);
    }
  };
}

async function prepare(
  context: AdapterContext,
  spec: MinecraftAdapterSpec,
  loader: MinecraftLoaderSpec
): Promise<PreparedRuntime> {
  const options = readOptions(context);
  const backendOptions = { ...options, javaVersion: spec.javaVersion };
  const backend = resolveHostBackend(context.runtime.backend);
  const runtimeDirectory = join(context.stateDirectory, 'runtime');
  const gameDirectory = join(context.stateDirectory, 'game');
  const modsDirectory = join(gameDirectory, 'mods');
  const hmcDirectory = join(runtimeDirectory, 'HeadlessMC');
  const backendContext = {
    projectRoot: context.projectRoot,
    runtimeDirectory,
    port: context.endpoint.port
  };
  await clearStaleSession(context);
  await rm(modsDirectory, { recursive: true, force: true });
  await Promise.all([
    mkdir(modsDirectory, { recursive: true }),
    mkdir(hmcDirectory, { recursive: true }),
    mkdir(context.artifactsDirectory, { recursive: true }),
    mkdir(dirname(context.endpoint.tokenFile), { recursive: true })
  ]);

  if (options.build !== false && !options.mods) {
    const command = options.buildCommand
      ?? [join(context.projectRoot, gradleExecutable()), 'build'];
    await run(command[0]!, command.slice(1), context.projectRoot);
  }

  const modArtifacts = options.mods?.map((path) => resolve(context.projectRoot, path))
    ?? await discoverModArtifacts(context.projectRoot, loader.metadata);
  if (modArtifacts.length === 0 && !options.bridgeOnly) {
    throw new Error(`No ${loader.id} mod artifacts were found`);
  }
  for (const artifact of modArtifacts) {
    await copyFile(artifact, join(modsDirectory, pathBasename(artifact)));
  }

  const bridge = await prepareBridge(spec, loader);
  await copyFile(bridge, join(modsDirectory, 'mchd-bridge.jar'));

  const hmcJar = join(runtimeDirectory, HMC_FILENAME);
  await downloadIfMissing(HMC_URL, hmcJar, 'HeadlessMC');

  await backend.prepare(backendOptions, backendContext);
  const guestBackend = ['docker', 'macos', 'wsl'].includes(context.runtime.backend);
  const java = options.java ?? (guestBackend ? 'java' : defaultJava());
  const platformState = options.dockerPlatform?.replace('/', '-');
  const minecraftDirectory = join(
    context.stateDirectory,
    platformState ? `minecraft-${platformState}` : 'minecraft'
  );
  const [backendGame, backendMinecraft, backendToken, backendHmc] =
    await Promise.all([
      backend.mapPath(gameDirectory, backendOptions),
      backend.mapPath(minecraftDirectory, backendOptions),
      backend.mapPath(context.endpoint.tokenFile, backendOptions),
      backend.mapPath(hmcJar, backendOptions)
    ]);
  const backendJava = guestBackend ? java : await backend.mapPath(java, backendOptions);
  const gameArgs = options.server
    ? `--quickPlayMultiplayer ${options.server}`
    : '';
  await writeFile(join(hmcDirectory, 'config.properties'), [
    `hmc.java.versions=${escapeProperty(backendJava)}`,
    `hmc.gamedir=${escapeProperty(backendGame)}`,
    `hmc.mcdir=${escapeProperty(backendMinecraft)}`,
    'hmc.offline=true',
    ...(options.username ? [`hmc.offline.username=${escapeProperty(options.username)}`] : []),
    ...(gameArgs ? [`hmc.gameargs=${escapeProperty(gameArgs)}`] : []),
    'hmc.rethrow.launch.exceptions=true',
    'hmc.exit.on.failed.command=true',
    `hmc.jvmargs=-Djava.awt.headless=true -Dmchd.tokenFileBase64=${Buffer.from(backendToken).toString('base64url')} -Dmchd.host=${context.endpoint.host} -Dmchd.port=${context.endpoint.port}`,
    ''
  ].join('\n'));

  await backend.runJava(backendJava, [
    '-jar', backendHmc, '--command', 'download', spec.gameVersion, '-noredownload'
  ], runtimeDirectory, backendOptions, backendContext);
  if (!await hasInstalledProfile(minecraftDirectory, loader.profileRegex)) {
    if (loader.installerUrl) {
      const installer = join(runtimeDirectory, `${loader.id}-${loader.version}-installer.jar`);
      await downloadIfMissing(loader.installerUrl, installer, loader.displayName);
      const backendInstaller = await backend.mapPath(installer, backendOptions);
      await backend.runJava(backendJava, [
        '-jar', backendInstaller, '--install-client', backendMinecraft
      ], runtimeDirectory, backendOptions, backendContext);
    } else {
      await backend.runJava(backendJava, [
        '-jar', backendHmc, '--command', loader.installCommand, spec.gameVersion,
        '--uid', loader.version, '--java', String(spec.javaVersion)
      ], runtimeDirectory, backendOptions, backendContext);
    }
  }

  return {
    ...await backend.launchJava(
      backendJava,
      [
        '-jar', backendHmc, '--command', 'launch', loader.profileRegex,
        '-regex', '--retries', '20'
      ],
      runtimeDirectory,
      { LIBGL_ALWAYS_SOFTWARE: '1' },
      backendOptions,
      backendContext
    ),
    endpoint: context.endpoint
  };
}

async function downloadIfMissing(url: string, path: string, name: string): Promise<void> {
  if (await exists(path)) {
    return;
  }
  let failure = 'unknown error';
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (response.ok) {
        await writeFile(path, new Uint8Array(await response.arrayBuffer()));
        return;
      }
      failure = `HTTP ${response.status}`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 5) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1_000));
    }
  }
  throw new Error(`Could not download ${name}: ${failure}`);
}

async function hasInstalledProfile(
  minecraftDirectory: string,
  profileRegex: string
): Promise<boolean> {
  const versionsDirectory = join(minecraftDirectory, 'versions');
  if (!await exists(versionsDirectory)) {
    return false;
  }
  const pattern = new RegExp(profileRegex);
  return (await readdir(versionsDirectory)).some((name) => pattern.test(name));
}

async function clearStaleSession(context: AdapterContext): Promise<void> {
  if (!await exists(context.endpoint.tokenFile)) {
    return;
  }
  if (await bridgeIsActive(context)) {
    throw new Error(
      `An MC Headless Debug runtime is already active on `
      + `${context.endpoint.host}:${context.endpoint.port}`
    );
  }
  await Promise.all([
    rm(context.endpoint.tokenFile, { force: true }),
    rm(join(dirname(context.endpoint.tokenFile), 'port'), { force: true })
  ]);
}

async function bridgeIsActive(context: AdapterContext): Promise<boolean> {
  let token: string;
  try {
    token = (await readFile(context.endpoint.tokenFile, 'utf8')).trim();
  } catch {
    return false;
  }
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return false;
  }

  return new Promise((resolveActive) => {
    const socket = createConnection({
      host: context.endpoint.host,
      port: context.endpoint.port
    });
    let settled = false;
    let response = '';
    const finish = (active: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolveActive(active);
    };
    const timeout = setTimeout(() => finish(false), 1_000);
    socket.setEncoding('utf8');
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 'adapter-session-probe',
        token,
        method: 'runtime.status',
        params: {}
      })}\n`);
    });
    socket.on('data', (chunk) => {
      response += chunk;
      const newline = response.indexOf('\n');
      if (newline < 0) {
        return;
      }
      try {
        const value = JSON.parse(response.slice(0, newline)) as {
          id?: string;
          result?: { ready?: boolean };
        };
        finish(
          value.id === 'adapter-session-probe'
          && value.result?.ready === true
        );
      } catch {
        finish(false);
      }
    });
    socket.once('error', () => finish(false));
    socket.once('end', () => finish(false));
  });
}

async function doctor(context: AdapterContext, javaVersion: number) {
  const options = { ...readOptions(context), javaVersion };
  return await resolveHostBackend(context.runtime.backend).doctor(options);
}

async function launch(
  context: AdapterContext,
  runtime: PreparedRuntime
): Promise<RuntimeProcess> {
  const child = spawn(runtime.command, runtime.args, {
    cwd: runtime.cwd,
    env: {
      ...process.env,
      ...runtime.env
    },
    stdio: 'inherit',
    detached: true
  });
  if (child.pid === undefined) {
    throw new Error('Headless runtime did not provide a process ID');
  }

  const exited = new Promise<number>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolveExit(code ?? (signal ? 128 : 1));
    });
  });
  return {
    pid: child.pid,
    exited,
    async stop() {
      if (child.exitCode === null && !child.killed) {
        if (runtime.stopCommand) {
          await run(
            runtime.stopCommand.command,
            runtime.stopCommand.args,
            runtime.stopCommand.cwd,
            runtime.stopCommand.env
          );
        } else if (process.platform === 'win32') {
          child.kill('SIGTERM');
        } else {
          process.kill(-child.pid!, 'SIGTERM');
        }
      }
      const completed = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolveTimeout) => {
          setTimeout(() => resolveTimeout(false), 5_000);
        })
      ]);
      if (!completed && child.exitCode === null) {
        if (process.platform === 'win32') {
          child.kill('SIGKILL');
        } else {
          process.kill(-child.pid!, 'SIGKILL');
        }
      }
      await Promise.race([
        exited,
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 2_000))
      ]);
    }
  };
}

async function prepareBridge(
  spec: MinecraftAdapterSpec,
  loader: MinecraftLoaderSpec
): Promise<string> {
  const packagedBridge = join(spec.packageDirectory, 'bridge', loader.bridgeArtifact);
  if (await exists(packagedBridge)) {
    return packagedBridge;
  }

  const gradle = join(spec.bridgeSourceDirectory, gradleExecutable());
  if (!await exists(gradle)) {
    throw new Error(`Bridge source is unavailable: ${spec.bridgeSourceDirectory}`);
  }
  await chmod(gradle, 0o755);
  await run(gradle, [loader.bridgeTask, '--console=plain'], spec.bridgeSourceDirectory);
  const outputDirectory = join(spec.bridgeSourceDirectory, 'build', 'libs');
  const files = await readdir(outputDirectory);
  const output = files.find((name) => (
    name.includes(`-${loader.id}.${spec.gameVersion}`)
    && name.endsWith('.jar')
    && !name.includes('-sources')
    && !name.includes('-dev-shadow')
    && !name.includes('-raw')
  ));
  if (!output) {
    throw new Error(`Built bridge artifact was not found for ${loader.id}`);
  }
  return join(outputDirectory, output);
}

async function discoverModArtifacts(
  projectRoot: string,
  metadata: string
): Promise<string[]> {
  const directories = [join(projectRoot, 'build', 'libs')];
  for (const entry of await readdir(projectRoot, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      directories.push(join(projectRoot, entry.name, 'build', 'libs'));
    }
  }

  const artifacts: string[] = [];
  for (const directory of directories) {
    if (!await exists(directory)) {
      continue;
    }
    for (const name of await readdir(directory)) {
      if (name.endsWith('.jar')
          && !name.includes('-sources')
          && !name.includes('-raw')
          && await containsLoaderMetadata(join(directory, name), metadata)) {
        artifacts.push(join(directory, name));
      }
    }

    function containsLoaderMetadata(path: string, expected: string): Promise<boolean> {
      return new Promise((resolveMetadata, reject) => {
        yauzl.open(path, { lazyEntries: true }, (error, zip) => {
          if (error || !zip) {
            reject(error ?? new Error(`Could not open JAR: ${path}`));
            return;
          }
          let settled = false;
          const finish = (result: boolean) => {
            if (settled) {
              return;
            }
            settled = true;
            zip.close();
            resolveMetadata(result);
          };
          zip.on('entry', (entry) => {
            if (entry.fileName === expected) {
              finish(true);
            } else {
              zip.readEntry();
            }
          });
          zip.once('end', () => finish(false));
          zip.once('error', (zipError) => {
            if (!settled) {
              settled = true;
              zip.close();
              reject(zipError);
            }
          });
          zip.readEntry();
        });
      });
    }
  }
  return [...new Set(artifacts)].sort();
}

function readOptions(context: AdapterContext): AdapterOptions {
  return context.runtime.options as AdapterOptions;
}

async function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit'
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(
          `Command failed (${code ?? signal ?? 'unknown'}): `
          + [command, ...args].join(' ')
        ));
      }
    });
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}



function defaultJava(): string {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  return process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, 'bin', executable)
    : executable;
}

function gradleExecutable(): string {
  return process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
}

function escapeProperty(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}
