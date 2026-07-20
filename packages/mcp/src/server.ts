#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { rpcMethodSchema } from '@mc-headless-debug/protocol';
import { readProjectConfig, RpcClient } from '@mc-headless-debug/cli';

const server = new McpServer({
  name: 'mc-headless-debug',
  version: '0.1.0'
});

server.registerTool(
  'minecraft_call',
  {
    description: 'Call the authenticated MC Headless Debug bridge',
    inputSchema: {
      method: rpcMethodSchema,
      params: z.record(z.string(), z.unknown()).default({}),
      config: z.string().default('mchd.config.yaml')
    }
  },
  async ({ method, params, config }) => {
    const project = await readProjectConfig(config);
    const client = await RpcClient.fromEndpoint(project.endpoint);
    const result = await client.call(method, params);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }
);

await server.connect(new StdioServerTransport());
