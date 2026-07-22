import { createHash } from 'node:crypto';
import { access, chmod } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { AdapterCheck, ProcessCommand } from '@mc-headless-debug/engine';

const DOCKER_PROXY_PORT = 65000;


export interface BackendOptions {
  distribution?: string;
  dockerImage?: string;
  dockerPlatform?: string;
  java?: string;
  javaVersion?: number;
  publishPorts?: number[];
}

export interface BackendContext {
  projectRoot: string;
  runtimeDirectory: string;
  port: number;
}

export interface HostBackend {
  readonly id: string;
  doctor(options: BackendOptions): Promise<AdapterCheck[]>;
  mapPath(path: string, options: BackendOptions): Promise<string>;
  prepare(options: BackendOptions, context: BackendContext): Promise<void>;
  runJava(
    java: string,
    args: string[],
    cwd: string,
    options: BackendOptions,
    context: BackendContext
  ): Promise<void>;
  launchJava(
    java: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    options: BackendOptions,
    context: BackendContext
  ): Promise<ProcessCommand>;
}

export function resolveHostBackend(id: string): HostBackend {
  switch (id) {
    case 'native':
      return nativeBackend(false);
    case 'actions':
      return nativeBackend(true);
    case 'docker':
      return dockerBackend(false);
    case 'macos':
      return dockerBackend(true);
    case 'wsl':
      return wslBackend();
    default:
      throw new Error(`Unknown runtime backend: ${id}`);
  }
}

function nativeBackend(actions: boolean): HostBackend {
  return {
    id: actions ? 'actions' : 'native',
    async doctor(options) {
      const java = options.java ?? defaultJava();
      const checks = await nativeChecks(java, options.javaVersion ?? 25);
      if (actions) {
        checks.unshift({
          name: 'GitHub Actions',
          status: process.env.GITHUB_ACTIONS === 'true' ? 'ok' : 'error',
          detail: process.env.GITHUB_ACTIONS === 'true'
            ? 'Hosted Actions environment'
            : 'GITHUB_ACTIONS is not true'
        });
      }
      return checks;
    },
    async mapPath(path) {
      return path;
    },
    async prepare() {},
    async runJava(java, args, cwd) {
      await run(java, args, cwd);
    },
    async launchJava(java, args, cwd, env) {
      return {
        command: 'xvfb-run',
        args: [java, '-Dhmc.check.xvfb=true', ...args],
        cwd,
        env
      };
    }
  };
}

function dockerBackend(requireMacOs: boolean): HostBackend {
  return {
    id: requireMacOs ? 'macos' : 'docker',
    async doctor() {
      const docker = await capture('docker', ['version', '--format', '{{.Server.Version}}']);
      return [
        {
          name: 'Host platform',
          status: !requireMacOs || process.platform === 'darwin' ? 'ok' : 'error',
          detail: requireMacOs
            ? process.platform === 'darwin' ? 'macOS through Docker' : 'macos backend requires Darwin'
            : `${process.platform} through Docker`
        },
        {
          name: 'Docker',
          status: docker ? 'ok' : 'error',
          detail: docker ?? 'Docker daemon is unavailable'
        }
      ];
    },
    async mapPath(path) {
      return path;
    },
    async prepare(options) {
      const image = dockerImage(options);
      if (await succeeds('docker', ['image', 'inspect', image])) {
        return;
      }
      const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
      const dockerDirectory = join(packageDirectory, 'runtime', 'docker');
      await run('docker', [
        'build',
        ...dockerPlatformArgs(options),
        '--build-arg', `JAVA_VERSION=${options.javaVersion ?? 25}`,
        '--tag', image,
        dockerDirectory
      ], packageDirectory);
    },
    async runJava(_java, args, cwd, options, context) {
      const image = dockerImage(options);
      await run('docker', [
        'run', '--rm',
        ...dockerPlatformArgs(options),
        '--entrypoint', 'java',
        '--volume', `${context.projectRoot}:${context.projectRoot}`,
        '--volume', `${dirname(context.runtimeDirectory)}:${dirname(context.runtimeDirectory)}`,
        '--workdir', cwd,
        image,
        ...args
      ], context.projectRoot);
    },
    async launchJava(_java, args, cwd, env, options, context) {
      const image = dockerImage(options);
      const containerName = `mchd-${createHash('sha256')
        .update(context.runtimeDirectory)
        .digest('hex')
        .slice(0, 12)}`;
      const publishPorts = options.publishPorts ?? [];
      if (publishPorts.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
        throw new Error('publishPorts must contain TCP port numbers from 1 to 65535');
      }
      return {
        command: 'docker',
        args: [
          'run', '--rm',
          ...dockerPlatformArgs(options),
          '--name', containerName,
          '--publish', `127.0.0.1:${context.port}:${DOCKER_PROXY_PORT}`,
          ...publishPorts.flatMap((port) => [
            '--publish', `127.0.0.1:${port}:${port}`
          ]),
          '--volume', `${context.projectRoot}:${context.projectRoot}`,
          '--volume', `${dirname(context.runtimeDirectory)}:${dirname(context.runtimeDirectory)}`,
          '--workdir', cwd,
          '--env', `MCHD_PORT=${context.port}`,
          '--env', `MCHD_PROXY_PORT=${DOCKER_PROXY_PORT}`,
          ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
          image,
          'java', '-Dhmc.check.xvfb=true', ...args
        ],
        cwd: context.projectRoot,
        env: {},
        stopCommand: {
          command: 'docker',
          args: ['stop', '--time', '5', containerName],
          cwd: context.projectRoot,
          env: {}
        }
      };
    }
  };
}

function wslBackend(): HostBackend {
  return {
    id: 'wsl',
    async doctor(options) {
      const distribution = distributionArgs(options);
      const java = options.java ?? 'java';
      const version = await capture('wsl.exe', [...distribution, '--exec', java, '-version']);
      const xvfb = await succeeds('wsl.exe', [...distribution, '--exec', 'which', 'xvfb-run']);
      return [
        {
          name: 'Host platform',
          status: process.platform === 'win32' ? 'ok' : 'error',
          detail: process.platform === 'win32' ? 'Windows through WSL' : 'wsl backend requires Windows'
        },
        {
          name: 'WSL Java',
          status: version?.includes(`"${options.javaVersion ?? 25}`)
            ? 'ok'
            : version ? 'warn' : 'error',
          detail: version ?? `Java ${options.javaVersion ?? 25} is unavailable in WSL`
        },
        {
          name: 'WSL virtual display',
          status: xvfb ? 'ok' : 'error',
          detail: xvfb ? 'xvfb-run available in WSL' : 'xvfb-run is unavailable in WSL'
        }
      ];
    },
    async mapPath(path, options) {
      const output = await capture('wsl.exe', [
        ...distributionArgs(options),
        '--exec', 'wslpath', '-a', path
      ]);
      if (!output) {
        throw new Error(`Could not translate path into WSL: ${path}`);
      }
      return output;
    },
    async prepare() {},
    async runJava(java, args, cwd, options) {
      const linuxCwd = await this.mapPath(cwd, options);
      await run('wsl.exe', [
        ...distributionArgs(options),
        '--cd', linuxCwd,
        '--exec', java,
        ...args
      ], cwd);
    },
    async launchJava(java, args, cwd, env, options) {
      const linuxCwd = await this.mapPath(cwd, options);
      return {
        command: 'wsl.exe',
        args: [
          ...distributionArgs(options),
          '--cd', linuxCwd,
          '--exec', 'env',
          ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
          'xvfb-run', java, '-Dhmc.check.xvfb=true', ...args
        ],
        cwd,
        env: {}
      };
    }
  };
}

async function nativeChecks(java: string, expectedVersion: number): Promise<AdapterCheck[]> {
  const javaVersion = await capture(java, ['-version']);
  const xvfb = await commandExists('xvfb-run');
  return [
    {
      name: 'Host platform',
      status: process.platform === 'linux' ? 'ok' : 'error',
      detail: process.platform === 'linux' ? 'Linux native backend' : 'native backend requires Linux'
    },
    {
      name: 'Java',
      status: javaVersion?.includes(`"${expectedVersion}`)
        ? 'ok' : javaVersion ? 'warn' : 'error',
      detail: javaVersion ?? `Java ${expectedVersion} not found`
    },
    {
      name: 'Virtual display',
      status: xvfb ? 'ok' : 'error',
      detail: xvfb ? 'xvfb-run available' : 'xvfb-run not found'
    }
  ];
}

function distributionArgs(options: BackendOptions): string[] {
  return options.distribution ? ['--distribution', options.distribution] : [];
}

function dockerPlatformArgs(options: BackendOptions): string[] {
  if (options.dockerPlatform === undefined) {
    return [];
  }
  if (!['linux/amd64', 'linux/arm64'].includes(options.dockerPlatform)) {
    throw new Error('dockerPlatform must be linux/amd64 or linux/arm64');
  }
  return ['--platform', options.dockerPlatform];
}

function dockerImage(options: BackendOptions): string {
  const platform = options.dockerPlatform?.replace('/', '-');
  return options.dockerImage
    ?? `mchd-runtime:java${options.javaVersion ?? 25}${platform ? `-${platform}` : ''}-v3`;
}

function defaultJava(): string {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java';
  return process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', executable) : executable;
}

async function commandExists(command: string): Promise<boolean> {
  const path = process.env.PATH ?? '';
  for (const directory of path.split(delimiter)) {
    try {
      await access(join(directory, command));
      return true;
    } catch {}
  }
  return false;
}

async function succeeds(command: string, args: string[]): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

async function capture(command: string, args: string[]): Promise<string | null> {
  return await new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.once('error', () => resolve(null));
    child.once('exit', (code) => resolve(
      code === 0 ? Buffer.concat(chunks).toString('utf8').trim() : null
    ));
  });
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  if (command.endsWith('gradlew')) {
    await chmod(command, 0o755);
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
      }
    });
  });
}
