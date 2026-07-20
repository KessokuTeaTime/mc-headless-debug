import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readProjectConfig } from './config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true })
  ));
});

describe('readProjectConfig', () => {
  it('rejects token paths outside the project state directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mchd-config-'));
    temporaryDirectories.push(directory);
    const config = join(directory, 'mchd.config.yaml');
    await writeFile(config, `
schemaVersion: 1
projectRoot: .
runtime:
  adapter: example/1/test
endpoint:
  host: 127.0.0.1
  port: 25570
  tokenFile: ../secret
`);

    await expect(readProjectConfig(config))
      .rejects.toThrow('must be inside the project .mchd directory');
  });

  it('rejects a symlinked project state directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mchd-config-'));
    temporaryDirectories.push(directory);
    const outside = join(directory, 'outside');
    await mkdir(outside);
    await symlink(outside, join(directory, '.mchd'));
    const config = join(directory, 'mchd.config.yaml');
    await writeFile(config, `
schemaVersion: 1
projectRoot: .
runtime:
  adapter: example/1/test
endpoint:
  host: 127.0.0.1
  port: 25570
  tokenFile: .mchd/token
`);

    await expect(readProjectConfig(config))
      .rejects.toThrow('must not contain symlinks');
  });
});
