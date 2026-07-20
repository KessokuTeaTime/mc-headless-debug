import type { AdapterCheck } from '@mc-headless-debug/engine';

export async function runDoctor(
  adapterChecks: AdapterCheck[] = []
): Promise<AdapterCheck[]> {
  return [
    {
      name: 'Node.js',
      status: Number(process.versions.node.split('.')[0]) >= 24 ? 'ok' : 'error',
      detail: process.version
    },
    ...adapterChecks
  ];
}
