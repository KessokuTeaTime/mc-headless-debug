#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { rpcMethodSchema } from '@mc-headless-debug/protocol';
import { readProjectConfig, RpcClient } from '@mc-headless-debug/cli';
const timeoutSchema = z.int().positive().max(600_000).default(30_000);
const inputEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('key'),
    key: z.int().min(0),
    scancode: z.int().min(0).default(0),
    action: z.enum(['press', 'release', 'repeat']),
    modifiers: z.int().min(0).default(0),
    delayTicks: z.int().min(0).default(0)
  }),
  z.object({
    type: z.literal('text'),
    text: z.string(),
    modifiers: z.int().min(0).default(0),
    delayTicks: z.int().min(0).default(0)
  }),
  z.object({
    type: z.literal('mouseMove'),
    x: z.number(),
    y: z.number(),
    space: z.enum(['gui', 'window']).default('gui'),
    delayTicks: z.int().min(0).default(0)
  }),
  z.object({
    type: z.literal('mouseButton'),
    button: z.int().min(0),
    action: z.enum(['press', 'release']),
    modifiers: z.int().min(0).default(0),
    delayTicks: z.int().min(0).default(0)
  }),
  z.object({
    type: z.literal('mouseScroll'),
    xOffset: z.number().default(0),
    yOffset: z.number(),
    delayTicks: z.int().min(0).default(0)
  })
]);

const server = new McpServer({
  name: 'mc-headless-debug',
  version: '0.1.0'
});

server.registerTool(
  'minecraft_call',
  {
    description: 'Call any authenticated MC Headless Debug bridge capability',
    inputSchema: {
      method: rpcMethodSchema,
      params: z.record(z.string(), z.unknown()).default({}),
      config: z.string().default('mchd.config.yaml'),
      timeoutMs: timeoutSchema
    }
  },
  async ({ method, params, config, timeoutMs }) => {
    const project = await readProjectConfig(config);
    const client = await RpcClient.fromEndpoint(project.endpoint);
    const result = await client.call(method, params, timeoutMs);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };

  }
);

server.registerTool(
  'minecraft_input',
  {
    description: 'Dispatch an ordered sequence of raw keyboard, text, and mouse events through Minecraft input handlers',
    inputSchema: {
      events: z.array(inputEventSchema).min(1).max(1024),
      config: z.string().default('mchd.config.yaml'),
      timeoutMs: timeoutSchema
    }
  },
  async ({ events, config, timeoutMs }) => {
    const project = await readProjectConfig(config);
    const client = await RpcClient.fromEndpoint(project.endpoint);
    const result = await client.call('input.dispatch', { events }, timeoutMs);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }
);

await server.connect(new StdioServerTransport());
