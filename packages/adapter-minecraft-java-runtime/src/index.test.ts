import { describe, expect, it } from 'vitest';
import { createMinecraftJavaAdapter } from './index.js';
import { resolveHostBackend } from './host-backends.js';

const spec = {
  gameVersion: '1.21.1',
  javaVersion: 21,
  packageDirectory: '/adapter',
  bridgeSourceDirectory: '/bridge',
  loaders: {
    fabric: {
      id: 'fabric',
      displayName: 'Fabric',
      version: '0.19.3',
      installCommand: 'fabric',
      profileRegex: 'fabric',
      metadata: 'fabric.mod.json',
      bridgeArtifact: 'fabric.jar',
      bridgeTask: ':fabric:shadowJar'
    }
  }
};

describe('Minecraft Java runtime adapter', () => {
  it('declares the complete bridge contract', () => {
    const adapter = createMinecraftJavaAdapter(spec, 'fabric');

    expect(adapter.manifest.id).toBe('minecraft-java/1.21.1/fabric');
    expect(adapter.manifest.requirements.java).toBe(21);
    expect(adapter.manifest.capabilities).toContain('world.publish');
    expect(adapter.manifest.capabilities).toContain('player.list');
    expect(adapter.manifest.capabilities).toContain('runtime.lifecycle');
    expect(adapter.manifest.capabilities).toContain('wait.frames');
    expect(adapter.manifest.capabilities).toContain('input.dispatch');
    expect(adapter.manifest.capabilities).toContain('input.state');
    expect(adapter.manifest.capabilities).toContain('world.inspect');
    expect(adapter.manifest.capabilities).toContain('block.inspect');
    expect(adapter.manifest.capabilities).toContain('player.get');
    expect(adapter.manifest.capabilities).toContain('player.inventory');
    expect(adapter.manifest.capabilities).toContain('window.resize');
  });

  it('rejects unknown loaders', () => {
    expect(() => createMinecraftJavaAdapter(spec, 'neoforge'))
      .toThrow('Unknown Minecraft 1.21.1 loader: neoforge');
  });

  it('publishes configured game ports from Docker runtimes', async () => {
    const backend = resolveHostBackend('macos');
    const process = await backend.launchJava(
      'java',
      ['-version'],
      '/state/runtime',
      {},
      { dockerImage: 'mchd-test', dockerPlatform: 'linux/amd64', publishPorts: [25565] },
      { projectRoot: '/project', runtimeDirectory: '/state/runtime', port: 25570 }
    );

    expect(process.args).toContain('127.0.0.1:25570:65000');
    expect(process.args).toContain('127.0.0.1:25565:25565');
    expect(process.args).toContain('linux/amd64');
    expect(process.args).toContain('/state:/state');
  });

  it('rejects invalid Docker game ports', async () => {
    const backend = resolveHostBackend('macos');

    await expect(backend.launchJava(
      'java',
      [],
      '/runtime',
      {},
      { dockerImage: 'mchd-test', publishPorts: [70000] },
      { projectRoot: '/project', runtimeDirectory: '/runtime', port: 25570 }
    )).rejects.toThrow('publishPorts must contain TCP port numbers from 1 to 65535');
  });
});
