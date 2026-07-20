import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  rpcResponseSchema,
  type Endpoint,
  type RpcMethod
} from '@mc-headless-debug/protocol';

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export class BridgeRpcError extends Error {
  public constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown
  ) {
    super(message);
  }
}

export class RpcClient {
  public constructor(
    private readonly endpoint: Endpoint,
    private readonly token: string
  ) {
  }

  public static async fromEndpoint(endpoint: Endpoint): Promise<RpcClient> {
    const token = (await readFile(endpoint.tokenFile, 'utf8')).trim();
    if (!/^[0-9a-f]{64}$/.test(token)) {
      throw new Error('Bridge token must be exactly 64 lowercase hexadecimal characters');
    }
    return new RpcClient(endpoint, token);
  }

  public call(
    method: RpcMethod,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000
  ): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const socket = createConnection({
        host: this.endpoint.host,
        port: this.endpoint.port
      });
      let buffer = '';
      let settled = false;

      const finish = (action: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        action();
      };
      const timeout = setTimeout(() => {
        finish(() => reject(
          new Error(`RPC call timed out after ${timeoutMs} ms: ${method}`)
        ));
      }, timeoutMs);

      socket.setEncoding('utf8');
      socket.on('connect', () => {
        socket.write(`${JSON.stringify({
          jsonrpc: '2.0',
          id,
          token: this.token,
          method,
          params
        })}\n`);
      });
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, 'utf8') > MAX_RESPONSE_BYTES) {
          finish(() => reject(new Error('RPC response exceeds 16 MiB')));
          return;
        }
        const newline = buffer.indexOf('\n');
        if (newline < 0) {
          return;
        }
        try {
          const response = rpcResponseSchema.parse(
            JSON.parse(buffer.slice(0, newline))
          );
          if (response.id !== id) {
            throw new Error(`RPC response ID mismatch: expected ${id}, got ${response.id}`);
          }
          if (response.error) {
            finish(() => reject(new BridgeRpcError(
              response.error!.message,
              response.error!.code,
              response.error!.data
            )));
          } else {
            finish(() => resolve(response.result));
          }
        } catch (error) {
          finish(() => reject(error));
        }
      });
      socket.on('error', (error) => {
        finish(() => reject(error));
      });
      socket.on('end', () => {
        finish(() => reject(new Error('Bridge closed before returning a response')));
      });
      socket.on('close', () => {
        finish(() => reject(new Error('Bridge connection closed unexpectedly')));
      });
    });
  }
}
