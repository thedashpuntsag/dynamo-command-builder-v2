import assert from 'node:assert/strict';
import type { CommandExample, CommandId } from '../src/shared/commands';

const base = process.env.PLAYGROUND_URL ?? 'http://127.0.0.1:5173';
const prefix = `playground-smoke-${Date.now()}-`;
const createdKeys = ['item', 'batch', 'transaction', 'transaction-update'].map((suffix) => `${prefix}${suffix}`);

async function execute(command: CommandId, source: string, action = 'run') {
  const response = await fetch(`${base}/api/playground/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, source, action }),
  });
  const body = (await response.json()) as {
    ok: boolean;
    error?: unknown;
    result?: Record<string, unknown>;
    builtInput?: unknown;
  };
  assert.ok(response.ok && body.ok, `${command}: ${JSON.stringify(body.error)}`);
  return body;
}

async function main() {
  const response = await fetch(`${base}/api/playground/config`);
  assert.ok(response.ok);
  const { tableName, commands } = (await response.json()) as { tableName: string; commands: CommandExample[] };
  try {
    for (const example of commands) {
      const source = JSON.stringify(example.input).replaceAll('playground-', prefix);
      const built = await execute(example.id, source, 'build');
      assert.ok(built.builtInput);
      const reference = await execute(example.id, JSON.stringify(example.allFieldsInput), 'build');
      assert.ok(reference.builtInput);
      if (example.id === 'query' || example.id === 'scan') {
        const indexed = await execute(example.id, JSON.stringify(example.allFieldsInput));
        assert.ok(Number(indexed.result?.Count) > 0, `${example.name} index preset returned no seeded items.`);
      }
      const executed = await execute(example.id, source);
      if (example.id === 'get') {
        const item = executed.result?.Item as Record<string, unknown>;
        assert.equal(item.id, 'local-test-001');
        assert.ok(item.metadata && item.payload && item.tags);
      }
      if (example.id === 'put') {
        const read = await execute(
          'get',
          JSON.stringify({ tableName, key: { id: `${prefix}item` }, consistentRead: true })
        );
        const item = read.result?.Item as Record<string, unknown>;
        assert.deepEqual(item.tags, { $set: ['local', 'playground'] });
        assert.deepEqual(item.payload, { $binary: 'SGVsbG8=' });
      }
      if (example.id === 'update')
        assert.equal((executed.result?.Attributes as Record<string, unknown> | undefined)?.status, 'UPDATED');
      if (example.id === 'batch-write') assert.deepEqual(executed.result?.UnprocessedItems, {});
      console.log(`✓ ${example.name}: built and executed`);
    }
  } finally {
    for (const id of createdKeys) await execute('delete', JSON.stringify({ tableName, key: { id } }));
  }
  console.log('All 10 builders verified against DynamoDB Local; smoke-test writes cleaned up.');
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
