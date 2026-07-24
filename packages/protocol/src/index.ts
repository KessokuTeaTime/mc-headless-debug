import { z } from 'zod';

export const endpointSchema = z.object({
  host: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'),
  port: z.int().min(1).max(65535).default(25570),
  tokenFile: z.string().default('.mchd/token')
});
export type Endpoint = z.infer<typeof endpointSchema>;

export const adapterIdSchema = z.string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9./_-]*$/);

export const runtimeSchema = z.object({
  adapter: adapterIdSchema,
  backend: z.string().min(1).default('native'),
  options: z.record(z.string(), z.unknown()).default({})
});
export type RuntimeConfig = z.infer<typeof runtimeSchema>;

export const adapterManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: adapterIdSchema,
  displayName: z.string().min(1),
  engineApi: z.int().positive(),
  target: z.object({
    game: z.string().min(1),
    gameVersion: z.string().min(1),
    loader: z.string().min(1).optional(),
    loaderVersion: z.string().min(1).optional()
  }),
  capabilities: z.array(z.string().min(1)).default([]),
  requirements: z.record(z.string(), z.unknown()).default({})
});
export type AdapterManifest = z.infer<typeof adapterManifestSchema>;

export const projectConfigSchema = z.object({
  schemaVersion: z.literal(1),
  projectRoot: z.string().default('.'),
  artifacts: z.string().default('artifacts'),
  runtime: runtimeSchema,
  endpoint: endpointSchema,
  adapters: z.record(adapterIdSchema, z.string().min(1)).default({})
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export const rpcMethodSchema = z.string()
  .min(3)
  .regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/);
export type RpcMethod = z.infer<typeof rpcMethodSchema>;

export const rpcTimeoutSchema = z.int().positive().max(600_000).default(30_000);

export const scenarioStepSchema = z.object({
  name: z.string().min(1).optional(),
  call: rpcMethodSchema,
  with: z.record(z.string(), z.unknown()).default({}),
  timeoutMs: rpcTimeoutSchema,
  saveAs: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).optional()
});
export type ScenarioStep = z.infer<typeof scenarioStepSchema>;

export const scenarioSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  runtime: runtimeSchema.partial().optional(),
  steps: z.array(scenarioStepSchema).min(1)
});
export type Scenario = z.infer<typeof scenarioSchema>;

export const rpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.string().min(1),
  token: z.string().min(1),
  method: rpcMethodSchema,
  params: z.record(z.string(), z.unknown()).default({}),
  timeoutMs: rpcTimeoutSchema
});

export type RpcRequest = z.infer<typeof rpcRequestSchema>;

export const rpcErrorSchema = z.object({
  code: z.int(),
  message: z.string(),
  data: z.unknown().optional()
});

export const rpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.string().min(1),
  result: z.unknown().optional(),
  error: rpcErrorSchema.optional()
}).refine(
  (response) => (
    (response.result !== undefined) !== (response.error !== undefined)
  ),
  'RPC response must contain exactly one of result or error'
);
export type RpcResponse = z.infer<typeof rpcResponseSchema>;
