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
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';
import type {
  AdapterCheck,
  AdapterContext,
  PreparedRuntime,
  RuntimeAdapter,
  RuntimeProcess
} from '@mc-headless-debug/engine';

const HMC_VERSION = '2.10.0';
const HMC_FILENAME = `headlessmc-launcher-${HMC_VERSION}.jar`;
const HMC_URL = `https://github.com/3arthqu4ke/headlessmc/releases/download/${HMC_VERSION}/${HMC_FILENAME}`;
const CAPABILITIES = [
  'runtime.status',
  'runtime.stop',
  'world.create',
  'world.configure',
  'command.execute',
  'player.get',
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

type Loader = 'fabric' | 'neoforge';

interface AdapterOptions {
  build?: boolean;
  bridgeOnly?: boolean;
  buildCommand?: string[];
  mods?: string[];
  java?: string;
}

export function createMinecraft262Adapter(loader: Loader): RuntimeAdapter {
  const version = loaderVersion(loader);
  return {
    manifest: {
      schemaVersion: 1,
      id: `minecraft-java/26.2/${loader}`,
      displayName: `Minecraft Java 26.2 + ${loader === 'fabric' ? 'Fabric' : 'NeoForge'}`,
      engineApi: 1,
      target: {
        game: 'minecraft-java',
        gameVersion: '26.2',
        loader,
        loaderVersion: version
      },
      capabilities: CAPABILITIES,
      requirements: {
        java: 25,
        display: 'xvfb-or-headlessmc'
      }
    },
    async doctor(context) {
      return doctor(context);
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
      return prepare(context, loader);
    },
    async launch(context, runtime) {
      return launch(context, runtime);
    }
  };
}

async function prepare(
  context: AdapterContext,
  loader: Loader
): Promise<PreparedRuntime> {
  if (context.runtime.backend !== 'native') {
    throw new Error(
      `Adapter ${context.runtime.adapter} does not yet implement backend `
      + context.runtime.backend
    );
  }
  if (process.platform !== 'linux') {
    throw new Error(
      `Native headless rendering is not implemented on ${process.platform}; `
      + 'use a platform adapter providing Docker, WSL, or Actions'
    );
  }

  const options = readOptions(context);
  const runtimeDirectory = join(context.stateDirectory, 'runtime');
  const gameDirectory = join(context.stateDirectory, 'game');
  const modsDirectory = join(gameDirectory, 'mods');
  const hmcDirectory = join(runtimeDirectory, 'HeadlessMC');
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
    ?? await discoverModArtifacts(context.projectRoot, loader);
  if (modArtifacts.length === 0 && !options.bridgeOnly) {
    throw new Error(`No ${loader} mod artifacts were found`);
  }
  for (const artifact of modArtifacts) {
    await copyFile(artifact, join(modsDirectory, pathBasename(artifact)));
  }

  const bridge = await prepareBridge(loader);
  await copyFile(bridge, join(modsDirectory, 'mchd-bridge.jar'));

  const hmcJar = join(runtimeDirectory, HMC_FILENAME);
  if (!await exists(hmcJar)) {
    const response = await fetch(HMC_URL);
    if (!response.ok) {
      throw new Error(`Could not download HeadlessMC: ${response.status}`);
    }
    await writeFile(hmcJar, new Uint8Array(await response.arrayBuffer()));
  }

  const java = options.java ?? defaultJava();
  const minecraftDirectory = join(context.stateDirectory, 'minecraft');
  await writeFile(join(hmcDirectory, 'config.properties'), [
    `hmc.java.versions=${escapeProperty(java)}`,
    `hmc.gamedir=${escapeProperty(gameDirectory)}`,
    `hmc.mcdir=${escapeProperty(minecraftDirectory)}`,
    'hmc.offline=true',
    'hmc.rethrow.launch.exceptions=true',
    'hmc.exit.on.failed.command=true',
    `hmc.jvmargs=-Djava.awt.headless=true -Dmchd.tokenFileBase64=${Buffer.from(context.endpoint.tokenFile).toString('base64url')} -Dmchd.host=${context.endpoint.host} -Dmchd.port=${context.endpoint.port}`,
    ''
  ].join('\n'));

  await run(java, [
    '-jar',
    hmcJar,
    '--command',
    'download',
    '26.2'
  ], runtimeDirectory);
  await run(java, [
    '-jar',
    hmcJar,
    '--command',
    loader,
    '26.2',
    '--uid',
    loaderVersion(loader),
    '--java',
    '25'
  ], runtimeDirectory);

  return {
    command: 'xvfb-run',
    args: [
      java,
      '-Dhmc.check.xvfb=true',
      '-jar',
      hmcJar,
      '--command',
      'launch',
      loaderProfileRegex(loader),
      '-regex',
      '--retries',
      '3'
    ],
    cwd: runtimeDirectory,
    env: {
      LIBGL_ALWAYS_SOFTWARE: '1'
    },
    endpoint: context.endpoint
  };
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

async function doctor(context: AdapterContext): Promise<AdapterCheck[]> {
  const java = readOptions(context).java ?? defaultJava();
  const javaVersion = await captureVersion(java, ['-version']);
  const xvfbRun = await commandExists('xvfb-run');
  return [
    {
      name: 'Host platform',
      status: process.platform === 'linux' ? 'ok' : 'error',
      detail: process.platform === 'linux'
        ? 'Linux native backend'
        : `${process.platform} requires another backend adapter`
    },
    {
      name: 'Java',
      status: javaVersion?.includes('"25') ? 'ok' : javaVersion ? 'warn' : 'error',
      detail: javaVersion ?? 'Java 25 not found'
    },
    {
      name: 'Virtual display',
      status: xvfbRun ? 'ok' : 'error',
      detail: xvfbRun
        ? 'xvfb-run available'
        : 'xvfb-run not found'
    }
  ];
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
        process.kill(-child.pid!, 'SIGTERM');
      }
      const completed = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolveTimeout) => {
          setTimeout(() => resolveTimeout(false), 5_000);
        })
      ]);
      if (!completed && child.exitCode === null) {
        process.kill(-child.pid!, 'SIGKILL');
      }
      await Promise.race([
        exited,
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 2_000))
      ]);
    }
  };
}

async function prepareBridge(loader: Loader): Promise<string> {
  const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const packagedBridge = join(packageDirectory, 'bridge', `${loader}.jar`);
  if (await exists(packagedBridge)) {
    return packagedBridge;
  }

  const repositoryRoot = resolve(packageDirectory, '..', '..');
  const bridgeRoot = join(
    repositoryRoot,
    'adapters',
    'minecraft-java',
    '26.2',
    'bridge'
  );
  const gradle = join(bridgeRoot, gradleExecutable());
  if (!await exists(gradle)) {
    throw new Error(`Bridge source is unavailable: ${bridgeRoot}`);
  }
  await chmod(gradle, 0o755);
  await run(gradle, [`:${loader}:shadowJar`, '--console=plain'], bridgeRoot);
  const outputDirectory = join(bridgeRoot, 'build', 'libs');
  const files = await readdir(outputDirectory);
  const output = files.find((name) => (
    name.includes(`-${loader}.26.2`)
    && name.endsWith('.jar')
    && !name.includes('-sources')
  ));
  if (!output) {
    throw new Error(`Built bridge artifact was not found for ${loader}`);
  }
  return join(outputDirectory, output);
}

async function discoverModArtifacts(
  projectRoot: string,
  loader: Loader
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
          && await containsLoaderMetadata(join(directory, name), loader)) {
        artifacts.push(join(directory, name));
      }
    }

    function containsLoaderMetadata(path: string, loader: Loader): Promise<boolean> {
      const expected = loader === 'fabric'
        ? 'fabric.mod.json'
        : 'META-INF/neoforge.mods.toml';
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

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
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

async function commandExists(command: string): Promise<boolean> {
  const path = process.env.PATH ?? '';
  for (const directory of path.split(process.platform === 'win32' ? ';' : ':')) {
    if (await exists(join(directory, command))) {
      return true;
    }
  }
  return false;
}

async function captureVersion(
  command: string,
  args: string[]
): Promise<string | undefined> {
  return new Promise((resolveVersion) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.once('error', () => resolveVersion(undefined));
    child.once('exit', (code) => {
      resolveVersion(
        code === 0 ? output.trim().split('\n')[0] : undefined
      );
    });
  });
}

function loaderVersion(loader: Loader): string {
  return loader === 'fabric' ? '0.19.3' : '26.2.0.25-beta';
}

function loaderProfileRegex(loader: Loader): string {
  return loader === 'fabric'
    ? '.*fabric-loader-0\\.19\\.3-26\\.2.*'
    : '.*neoforge-26\\.2\\.0\\.25-beta.*';
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
