import {
  lstat,
  readFile,
  realpath
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import {
  projectConfigSchema,
  scenarioSchema,
  type ProjectConfig,
  type Scenario
} from '@mc-headless-debug/protocol';
import { parse } from 'yaml';

export async function readProjectConfig(path = 'mchd.config.yaml'): Promise<ProjectConfig> {
  const configPath = resolve(path);
  const content = await readFile(configPath, 'utf8');
  const config = projectConfigSchema.parse(parse(content));
  const projectRoot = await realpath(resolve(dirname(configPath), config.projectRoot));
  const stateDirectory = resolve(projectRoot, '.mchd');
  const tokenFile = resolve(projectRoot, config.endpoint.tokenFile);
  const tokenRelative = relative(stateDirectory, tokenFile);
  if (tokenRelative.startsWith('..') || resolve(stateDirectory, tokenRelative) !== tokenFile) {
    throw new Error('endpoint.tokenFile must be inside the project .mchd directory');
  }
  await rejectSymlinks(stateDirectory, tokenFile);
  return {
    ...config,
    projectRoot,
    artifacts: resolve(projectRoot, config.artifacts),
    endpoint: {
      ...config.endpoint,
      tokenFile
    }
  };
}

async function rejectSymlinks(root: string, target: string): Promise<void> {
  const segments = [root];
  let current = root;
  for (const segment of relative(root, target).split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, segment);
    segments.push(current);
  }

  for (const path of segments) {
    try {
      if ((await lstat(path)).isSymbolicLink()) {
        throw new Error(`MC Headless Debug state path must not contain symlinks: ${path}`);
      }
    } catch (error) {
      if (isFileNotFound(error)) {
        return;
      }
      throw error;
    }
  }
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT';
}

export async function readScenario(path: string): Promise<Scenario> {
  const content = await readFile(resolve(path), 'utf8');
  return scenarioSchema.parse(parse(content));
}
