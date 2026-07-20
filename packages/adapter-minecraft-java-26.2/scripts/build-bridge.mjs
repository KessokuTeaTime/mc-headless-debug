import { spawn } from 'node:child_process';
import {
  copyFile,
  mkdir,
  readdir
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageDirectory, '..', '..');
const bridgeRoot = join(
  repositoryRoot,
  'adapters',
  'minecraft-java',
  '26.2',
  'bridge'
);
const gradle = join(bridgeRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

await run(gradle, ['build', '--console=plain'], bridgeRoot);
const outputDirectory = join(bridgeRoot, 'build', 'libs');
const packageBridgeDirectory = join(packageDirectory, 'bridge');
await mkdir(packageBridgeDirectory, { recursive: true });
const files = await readdir(outputDirectory);

for (const loader of ['fabric', 'neoforge']) {
  const artifact = files.find((name) => (
    name.includes(`-${loader}.26.2`)
    && name.endsWith('.jar')
    && !name.includes('-sources')
  ));
  if (!artifact) {
    throw new Error(`Bridge artifact was not found for ${loader}`);
  }
  await copyFile(
    join(outputDirectory, artifact),
    join(packageBridgeDirectory, `${loader}.jar`)
  );
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'inherit'
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        reject(new Error(`Bridge build failed with exit code ${code}`));
      }
    });
  });
}
