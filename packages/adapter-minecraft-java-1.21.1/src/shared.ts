import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMinecraftJavaAdapter,
  type MinecraftAdapterSpec
} from '@mc-headless-debug/adapter-minecraft-java-runtime';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageDirectory, '..', '..');
const spec: MinecraftAdapterSpec = {
  gameVersion: '1.21.1',
  javaVersion: 21,
  packageDirectory,
  bridgeSourceDirectory: join(
    repositoryRoot,
    'adapters',
    'minecraft-java',
    '1.21.1',
    'bridge'
  ),
  loaders: {
    fabric: {
      id: 'fabric',
      displayName: 'Fabric',
      version: '0.19.3',
      installCommand: 'fabric',
      profileRegex: '.*fabric-loader-0\\.19\\.3-1\\.21\\.1.*',
      metadata: 'fabric.mod.json',
      bridgeArtifact: 'fabric.jar',
      bridgeTask: ':fabric:remapJar'
    },
    neoforge: {
      id: 'neoforge',
      displayName: 'NeoForge',
      version: '21.1.243',
      installCommand: 'neoforge',
      installerUrl: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.243/neoforge-21.1.243-installer.jar',
      profileRegex: '.*neoforge-21\\.1\\.243.*',
      metadata: 'META-INF/neoforge.mods.toml',
      bridgeArtifact: 'neoforge.jar',
      bridgeTask: ':neoforge:shadowJar'
    }
  }
};

export function createMinecraft1211Adapter(loader: 'fabric' | 'neoforge') {
  return createMinecraftJavaAdapter(spec, loader);
}
