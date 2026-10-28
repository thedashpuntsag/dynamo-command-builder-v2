import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CreateTableCommand, DeleteTableCommand, DynamoDBClient, waitUntilTableExists } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { CommandExample, CommandId } from '../src/shared/commands';
import { buildCommand, executeCommand } from '../src/server/execute';
import { getExamples } from '../src/server/examples';
import { parseInput } from '../src/server/codec';

const base = process.env.PLAYGROUND_URL ?? 'http://127.0.0.1:5173';
const prefix = `playground-smoke-${randomUUID().slice(0, 8)}-`;
const createdKeys = ['item', 'batch', 'transaction', 'transaction-update', 'operations'].map(
  (suffix) => `${prefix}${suffix}`
);

type Outcome = {
  ok: boolean;
  error?: { name?: string; message?: string };
  result?: Record<string, unknown>;
  builtInput?: unknown;
};

async function request(command: CommandId, source: string, action = 'run'): Promise<Outcome> {
  const response = await fetch(`${base}/api/playground/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, source, action }),
  });
  return (await response.json()) as Outcome;
}

async function execute(command: CommandId, source: string, action = 'run') {
  const body = await request(command, source, action);
  assert.ok(body.ok, `${command}: ${JSON.stringify(body.error)}`);
  return body;
}

function sourceFor(input: Record<string, unknown>, command: CommandId): string {
  const rewritten = JSON.parse(
    JSON.stringify(input, (key, value: unknown) =>
      key !== 'tableName' && typeof value === 'string' && value.startsWith('playground-')
        ? prefix + value.slice('playground-'.length)
        : value
    )
  ) as Record<string, unknown>;
  if (command === 'transact-write' && 'clientRequestToken' in rewritten) rewritten.clientRequestToken = randomUUID();
  return JSON.stringify(rewritten);
}

async function verifyOperations(tableName: string) {
  const id = `${prefix}operations`;
  await execute(
    'put',
    JSON.stringify({
      tableName,
      item: {
        id,
        status: 'PENDING',
        version: 1,
        count: 10,
        stock: 5,
        tags: { $set: ['old', 'keep'] },
        labels: { $set: ['local'] },
        obsolete: 'remove me',
        history: ['old'],
        queue: ['last'],
        profile: { name: 'Original' },
        items: [{ sku: 'SKU-1', quantity: 1 }],
      },
    })
  );
  const updated = await execute(
    'update',
    JSON.stringify({
      tableName,
      key: { id },
      updates: [
        { attr: 'status', set: 'CONFIRMED' },
        { attr: 'obsolete', remove: true },
        { attr: 'attempts', add: 1 },
        { attr: 'labels', add: { $set: ['new'] } },
        { attr: 'tags', delete: { $set: ['old'] } },
        { attr: 'count', increment: 2 },
        { attr: 'stock', decrement: 1 },
        { attr: 'createdAt', ifNotExists: 123 },
        { attr: 'previousStatus', copyFrom: 'status' },
        { attr: 'history', append: ['new'] },
        { attr: 'queue', prepend: ['first'] },
        { attr: 'profile.name', set: 'Updated' },
        { attr: 'version', increment: 1 },
      ],
      condition: {
        and: [
          { attr: 'id', exists: true },
          { attr: 'version', eq: 1 },
          { attr: 'status', in: ['PENDING', 'READY'] },
          { attr: 'stock', between: [1, 10] },
          { attr: 'count', gt: 9 },
          { attr: 'count', gte: 10 },
          { attr: 'stock', lt: 10 },
          { attr: 'stock', lte: 5 },
          { attr: 'status', ne: 'CANCELLED' },
          { attr: 'deletedAt', notExists: true },
          { attr: 'history', size: { gte: 1 } },
          { attr: 'profile', type: 'M' },
          { attr: 'tags', contains: 'keep' },
          { attr: 'tags', notContains: 'blocked' },
          { attr: 'items[0].sku', beginsWith: 'SKU-' },
          { not: { attr: 'status', eq: 'CANCELLED' } },
          {
            or: [
              { attr: 'status', eq: 'PENDING' },
              { attr: 'status', eq: 'READY' },
            ],
          },
        ],
      },
      returnValues: 'ALL_NEW',
    })
  );
  const attributes = updated.result?.Attributes as Record<string, unknown>;
  assert.equal(attributes.status, 'CONFIRMED');
  assert.equal(attributes.version, 2);
  assert.equal(attributes.count, 12);
  assert.equal(attributes.stock, 4);
  assert.equal(attributes.attempts, 1);
  assert.equal(attributes.createdAt, 123);
  assert.equal(attributes.previousStatus, 'PENDING');
  assert.equal(attributes.obsolete, undefined);
  assert.deepEqual(attributes.history, ['old', 'new']);
  assert.deepEqual(attributes.queue, ['first', 'last']);
  assert.deepEqual(attributes.profile, { name: 'Updated' });
  assert.deepEqual(attributes.tags, { $set: ['keep'] });
  assert.deepEqual(new Set((attributes.labels as { $set: string[] }).$set), new Set(['local', 'new']));
  const defaulted = await execute(
    'update',
    JSON.stringify({
      tableName,
      key: { id },
      updates: [{ attr: 'createdAt', ifNotExists: 999 }],
      returnValues: 'ALL_NEW',
    })
  );
  assert.equal((defaulted.result?.Attributes as Record<string, unknown> | undefined)?.createdAt, 123);
  const rejected = await request(
    'update',
    JSON.stringify({
      tableName,
      key: { id },
      updates: [{ attr: 'status', set: 'WRONG' }],
      condition: { attr: 'version', eq: 999 },
    })
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error?.name, 'ConditionalCheckFailedException');
  const read = await execute('get', JSON.stringify({ tableName, key: { id }, consistentRead: true }));
  assert.equal((read.result?.Item as Record<string, unknown> | undefined)?.status, 'CONFIRMED');
  console.log('✓ All update operations and condition operators: verified state changes and condition failure');
}

async function verifyCompositeReference(endpoint: string) {
  const url = new URL(endpoint);
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'Smoke checks require a loopback DynamoDB endpoint.'
  );
  const client = new DynamoDBClient({
    endpoint,
    region: 'local',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const documentClient = DynamoDBDocumentClient.from(client);
  const tableName = `${prefix}composite`;
  let created = false;
  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' },
          { AttributeName: 'version', AttributeType: 'N' },
        ],
        KeySchema: [
          { AttributeName: 'id', KeyType: 'HASH' },
          { AttributeName: 'version', KeyType: 'RANGE' },
        ],
      })
    );
    created = true;
    await waitUntilTableExists({ client, maxWaitTime: 30, minDelay: 1, maxDelay: 2 }, { TableName: tableName });
    const example = getExamples(tableName).find((entry) => entry.id === 'batch-write')!;
    const input = parseInput(sourceFor(example.allFieldsInput, example.id));
    const result = await executeCommand(documentClient, buildCommand('batch-write', input, tableName));
    assert.ok(result && typeof result === 'object' && 'UnprocessedItems' in result);
    assert.deepEqual(result.UnprocessedItems, {});
    const read = await documentClient.send(
      new GetCommand({ TableName: tableName, Key: { id: `${prefix}batch`, version: 1 }, ConsistentRead: true })
    );
    assert.equal(read.Item?.status, 'READY');
    console.log('✓ Batch Write all-fields reference: executed against its required composite-key table');
  } finally {
    try {
      if (created) await client.send(new DeleteTableCommand({ TableName: tableName }));
    } finally {
      client.destroy();
    }
  }
}

async function main() {
  const response = await fetch(`${base}/api/playground/config`);
  assert.ok(response.ok);
  const { endpoint, tableName, commands } = (await response.json()) as {
    endpoint: string;
    tableName: string;
    commands: CommandExample[];
  };
  try {
    for (const example of commands) {
      const source = sourceFor(example.input, example.id);
      assert.ok((await execute(example.id, source, 'build')).builtInput);
      const reference = sourceFor(example.allFieldsInput, example.id);
      assert.ok((await execute(example.id, reference, 'build')).builtInput);
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
        assert.equal((executed.result?.Attributes as Record<string, unknown>)?.status, 'UPDATED');
      if (example.id === 'batch-write') assert.deepEqual(executed.result?.UnprocessedItems, {});
      if (example.id !== 'batch-write') {
        const referenced = await execute(example.id, reference);
        if (example.id === 'query' || example.id === 'scan')
          assert.ok(Number(referenced.result?.Count) > 0, `${example.name} index preset returned no seeded items.`);
      }
      console.log(`✓ ${example.name}: built both presets and executed compatible examples`);
    }
    await verifyOperations(tableName);
    await verifyCompositeReference(endpoint);
  } finally {
    for (const id of createdKeys) await execute('delete', JSON.stringify({ tableName, key: { id } }));
  }
  console.log('All presets and structured operators verified against DynamoDB Local; temporary data cleaned up.');
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
