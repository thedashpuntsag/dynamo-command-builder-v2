import assert from 'node:assert/strict';

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  UpdateTableCommand,
  waitUntilTableExists,
  type GlobalSecondaryIndex,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { buildValidatedGetCommand } from '../../src/command/get-command';
import { buildValidatedPutCommand } from '../../src/command/put-command';
import { buildValidatedQueryCommand } from '../../src/command/query-command';

const endpoint = process.env.DYNAMODB_LOCAL_ENDPOINT ?? 'http://localhost:8000';
const tableName = process.env.DYNAMODB_LOCAL_TABLE ?? 'command-builder-test';
const seedItemCount = 50;
const baseTimestamp = 1_798_000_000_000;
const index: GlobalSecondaryIndex = {
  IndexName: 'status-createdAt-index',
  KeySchema: [
    { AttributeName: 'status', KeyType: 'HASH' },
    { AttributeName: 'createdAt', KeyType: 'RANGE' },
  ],
  Projection: { ProjectionType: 'ALL' },
};

const client = new DynamoDBClient({
  endpoint,
  region: 'local',
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local',
  },
});
const documentClient = DynamoDBDocumentClient.from(client);

async function waitForDynamoDB(): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await client.send(new DescribeTableCommand({ TableName: tableName }));
      return;
    } catch (error: unknown) {
      lastError = error;

      if (
        error instanceof ResourceInUseException ||
        (error as { name?: string }).name === 'ResourceNotFoundException'
      ) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`DynamoDB Local did not become available at ${endpoint}.`, { cause: lastError });
}

async function createTable(): Promise<void> {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'id', AttributeType: 'S' },
          { AttributeName: 'status', AttributeType: 'S' },
          { AttributeName: 'createdAt', AttributeType: 'N' },
        ],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
        GlobalSecondaryIndexes: [index],
      })
    );
  } catch (error: unknown) {
    if (!(error instanceof ResourceInUseException)) {
      throw error;
    }
  }

  await waitUntilTableExists({ client, maxWaitTime: 10, minDelay: 1, maxDelay: 2 }, { TableName: tableName });
}

async function ensureIndex(): Promise<void> {
  const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
  const existingIndex = Table?.GlobalSecondaryIndexes?.find((entry) => entry.IndexName === index.IndexName);

  if (!existingIndex) {
    await client.send(
      new UpdateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [
          { AttributeName: 'status', AttributeType: 'S' },
          { AttributeName: 'createdAt', AttributeType: 'N' },
        ],
        GlobalSecondaryIndexUpdates: [{ Create: index }],
      })
    );
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { Table: currentTable } = await client.send(new DescribeTableCommand({ TableName: tableName }));
    const currentIndex = currentTable?.GlobalSecondaryIndexes?.find((entry) => entry.IndexName === index.IndexName);
    if (currentIndex?.IndexStatus === 'ACTIVE') {
      assert.deepStrictEqual(currentIndex.KeySchema, index.KeySchema, 'Existing index has an unexpected key schema.');
      assert.equal(currentIndex.Projection?.ProjectionType, 'ALL', 'Existing index must project all attributes.');
      const attributes = new Map(
        currentTable?.AttributeDefinitions?.map((entry) => [entry.AttributeName, entry.AttributeType])
      );
      assert.equal(attributes.get('status'), 'S', 'Index status key must be a string.');
      assert.equal(attributes.get('createdAt'), 'N', 'Index createdAt key must be a number.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Index "${index.IndexName}" did not become ACTIVE.`);
}

async function verifyIndex(items: { id: string; status: string; createdAt: number }[]): Promise<void> {
  for (const status of ['READY', 'PENDING']) {
    const expectedIds = items.filter((item) => item.status === status).map((item) => item.id);
    let verified = false;
    // Global secondary indexes are eventually consistent, even after the base-table reads succeed.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const { Items = [] } = await documentClient.send(
        new QueryCommand(
          buildValidatedQueryCommand({
            tableName,
            indexName: index.IndexName,
            partitionKeys: { status },
            sortKeys: { createdAt: { between: [baseTimestamp, baseTimestamp + (seedItemCount - 1) * 60_000] } },
            attributes: ['id', 'status', 'createdAt'],
            consistentRead: false,
            scanIndexForward: true,
          })
        )
      );
      const actualIds = Items.filter((item) => expectedIds.includes(String(item.id))).map((item) => item.id);
      if (actualIds.length === expectedIds.length) {
        assert.deepStrictEqual(
          actualIds,
          expectedIds,
          `Index query for ${status} returned items in an unexpected order.`
        );
        verified = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(verified, `Index query did not return all ${expectedIds.length} seeded ${status} items.`);
  }
}

async function main(): Promise<void> {
  await waitForDynamoDB();
  await createTable();
  await ensureIndex();

  const items = Array.from({ length: seedItemCount }, (_, index) => {
    const createdAt = baseTimestamp + index * 60_000;

    return {
      id: `local-test-${String(index + 1).padStart(3, '0')}`,
      source: 'dynamo-command-builder-v2',
      metadata: {
        date: new Date(createdAt).toISOString(),
        version: 1,
        correlationId: `seed-request-${index + 1}`,
        labels: { environment: 'local', region: 'ap-northeast-1' },
        // Literal dots, hyphens, and reserved words require aliases in expressions.
        'schema.version': '2.0',
        'trace-id': `trace-${index + 1}`,
        size: 0,
      },
      status: index % 2 === 0 ? 'READY' : 'PENDING',
      message: index % 2 === 0 ? 'Item is ready' : 'Item is pending',
      owner: {
        id: `user-${(index % 5) + 1}`,
        profile: {
          name: 'Local tester — Тест 🧪',
          contact: { email: `tester-${index + 1}@example.test`, phone: null },
          preferences: { notifications: true, locale: 'mn-MN', theme: 'dark' },
        },
        roles: new Set(['tester', index % 2 === 0 ? 'reviewer' : 'editor']),
      },
      order: {
        currency: 'USD',
        lines: [
          {
            sku: `sku-${index + 1}`,
            quantity: (index % 3) + 1,
            unitPrice: 19.95,
            options: { color: 'blue', dimensions: { width: 10.5, height: 0, unit: 'cm' } },
            discounts: [{ code: 'LOCAL', amount: 2.5 }],
          },
          { sku: 'sku-bonus', quantity: 1, unitPrice: 0, options: {}, discounts: [] },
        ],
        shipping: { address: { city: 'Ulaanbaatar', country: 'MN' }, instructions: '' },
      },
      workflow: {
        attempts: index % 4,
        enabled: index % 2 === 0,
        lastError: index % 2 === 0 ? null : { code: 'AWAITING_REVIEW', retryable: false },
        history: [
          { status: 'CREATED', at: createdAt, details: { actor: 'local-seed' } },
          { status: 'QUEUED', at: createdAt + 15_000, details: { queue: 'local', priority: index % 3 } },
        ],
      },
      tags: new Set(['local', 'integration', index % 2 === 0 ? 'ready' : 'pending']),
      checkpoints: new Set([0, 1, index + 2]),
      // A heterogeneous list, nested lists, and empty non-key values are valid DynamoDB data.
      samples: ['text', 42, -3.25, true, null, { nested: ['value', { active: false }] }, [1, 2]],
      emptyValues: { text: '', list: [], map: {} },
      payload: new TextEncoder().encode(`local-payload-${index + 1}`),
      createdAt,
      updatedAt: createdAt + 30_000,
      createdBy: 'local-seed',
      updatedBy: 'local-seed',
    };
  });

  await Promise.all(
    items.map((item) =>
      documentClient.send(
        new PutCommand(
          buildValidatedPutCommand({
            tableName,
            item,
          })
        )
      )
    )
  );

  const results = await Promise.all(
    items.map((item) =>
      documentClient.send(
        new GetCommand(
          buildValidatedGetCommand({
            tableName,
            key: { id: item.id },
            consistentRead: true,
          })
        )
      )
    )
  );

  results.forEach(({ Item }, index) => {
    const expectedItem = items[index];

    assert.ok(Item && expectedItem, `Missing seeded item at index ${index}.`);
    // Normalize binary views because the SDK may return a Buffer or Uint8Array.
    assert.ok(Item.payload instanceof Uint8Array, `Invalid binary payload for ${expectedItem.id}.`);
    assert.deepStrictEqual(
      { ...Item, payload: Uint8Array.from(Item.payload) },
      expectedItem,
      `Seeded item "${expectedItem.id}" did not round-trip correctly.`
    );
  });

  if (results.length !== seedItemCount) {
    throw new Error(`Expected to seed and read back ${seedItemCount} valid items.`);
  }

  await verifyIndex(items);

  console.log(`DynamoDB Local is ready at ${endpoint}.`);
  console.log(`Seeded and verified ${seedItemCount} items in table "${tableName}".`);
  console.log(`Verified index "${index.IndexName}" with status partition key and numeric createdAt sort key.`);
}

main()
  .catch((error: unknown) => {
    console.error('Failed to seed local DynamoDB:', error);
    process.exitCode = 1;
  })
  .finally(() => client.destroy());
