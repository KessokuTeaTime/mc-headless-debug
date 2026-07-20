import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcClient } from './rpc-client.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => rm(directory, { recursive: true, force: true })
  ));
});

describe('RpcClient', () => {
  it('authenticates and parses one NDJSON response', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mchd-rpc-'));
    temporaryDirectories.push(directory);
    const tokenFile = join(directory, 'token');
    const token = 'a'.repeat(64);
    await writeFile(tokenFile, `${token}\n`);

    const server = createServer((socket) => {
      socket.setEncoding('utf8');
      socket.once('data', (data) => {
        const request = JSON.parse(data.toString().trim()) as {
          id: string;
          token: string;
        };
        expect(request.token).toBe(token);
        socket.end(`${JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: { ready: true }
        })}\n`);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server has no TCP address');
    }

    try {
      const client = await RpcClient.fromEndpoint({
        host: '127.0.0.1',
        port: address.port,
        tokenFile
      });
      await expect(client.call('runtime.status')).resolves.toEqual({ ready: true });
    } finally {
      server.close();
    }
  });

  it('rejects immediately when the bridge closes without a response', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mchd-rpc-'));
    temporaryDirectories.push(directory);
    const tokenFile = join(directory, 'token');
    await writeFile(tokenFile, `${'b'.repeat(64)}\n`);
    const server = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server has no TCP address');
    }

    try {
      const client = await RpcClient.fromEndpoint({
        host: '127.0.0.1',
        port: address.port,
        tokenFile
      });
      await expect(client.call('runtime.status', {}, 10_000))
        .rejects.toThrow('closed');
    } finally {
      server.close();
    }
  });
});
