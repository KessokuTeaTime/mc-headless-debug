import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';

export async function initializeProject(directory: string): Promise<void> {
  const root = resolve(directory);
  const scenarioDirectory = join(root, 'scenarios');
  await mkdir(scenarioDirectory, { recursive: true });

  await writeFile(join(root, 'mchd.config.yaml'), stringify({
    schemaVersion: 1,
    projectRoot: '.',
    artifacts: 'artifacts',
    runtime: {
      adapter: 'minecraft-java/26.2/fabric',
      backend: 'native',
      options: {}
    },
    endpoint: {
      host: '127.0.0.1',
      port: 25570,
      tokenFile: '.mchd/token'
    },
    adapters: {
      'minecraft-java/26.2/fabric':
        '@mc-headless-debug/adapter-minecraft-java-26.2/fabric',
      'minecraft-java/26.2/neoforge':
        '@mc-headless-debug/adapter-minecraft-java-26.2/neoforge'
    }
  }), { flag: 'wx' });

  await writeFile(join(scenarioDirectory, 'smoke.yaml'), stringify({
    schemaVersion: 1,
    name: 'Join a test world and capture the HUD',
    steps: [
      {
        call: 'world.create',
        with: {
          name: 'mchd-smoke',
          seed: 1,
          gameMode: 'creative'
        }
      },
      {
        call: 'wait.ticks',
        with: {
          ticks: 20
        }
      },
      {
        call: 'screenshot.capture',
        with: {
          name: 'smoke-hud'
        },
        saveAs: 'smoke-hud'
      }
    ]
  }), { flag: 'wx' });
}

export interface AdapterTemplate {
  id: string;
  game: string;
  gameVersion: string;
  loader?: string;
}

export async function initializeAdapter(
  directory: string,
  template: AdapterTemplate
): Promise<void> {
  const root = resolve(directory);
  const sourceDirectory = join(root, 'src');
  await mkdir(sourceDirectory, { recursive: true });
  const packageName = `mchd-adapter-${template.id.replaceAll(/[^a-z0-9]+/g, '-')}`;
  const displayName = `${template.game} ${template.gameVersion}`
    + (template.loader ? ` + ${template.loader}` : '');

  await writeFile(join(root, 'package.json'), `${JSON.stringify({
    name: packageName,
    version: '0.1.0',
    type: 'module',
    main: './dist/index.js',
    types: './dist/index.d.ts',
    files: ['dist'],
    scripts: {
      build: 'tsc -b',
      check: 'tsc -b --pretty false',
      prepack: 'pnpm build'
    },
    peerDependencies: {
      '@mc-headless-debug/engine': '^0.1.0'
    },
    devDependencies: {
      '@mc-headless-debug/engine': '0.1.0',
      '@types/node': '24.10.13',
      typescript: '7.0.2'
    },
    publishConfig: {
      access: 'public'
    }
  }, null, 2)}\n`, { flag: 'wx' });

  await writeFile(join(root, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      target: 'ES2024',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      declaration: true,
      sourceMap: true,
      outDir: 'dist',
      rootDir: 'src',
      types: ['node']
    },
    include: ['src/**/*.ts']
  }, null, 2)}\n`, { flag: 'wx' });

  const loaderLine = template.loader
    ? `\n        loader: ${JSON.stringify(template.loader)},`
    : '';
  await writeFile(join(sourceDirectory, 'index.ts'), `\
import type { RuntimeAdapter } from '@mc-headless-debug/engine';

export function createAdapter(): RuntimeAdapter {
  return {
    manifest: {
      schemaVersion: 1,
      id: ${JSON.stringify(template.id)},
      displayName: ${JSON.stringify(displayName)},
      engineApi: 1,
      target: {
        game: ${JSON.stringify(template.game)},
        gameVersion: ${JSON.stringify(template.gameVersion)},${loaderLine}
      },
      capabilities: [],
      requirements: {}
    },
    async detect() {
      return {
        score: 0,
        reason: 'Implement project detection'
      };
    },
    async prepare() {
      throw new Error('Implement adapter preparation');
    },
    async launch() {
      throw new Error('Implement adapter launch');
    }
  };
}
`, { flag: 'wx' });
}
