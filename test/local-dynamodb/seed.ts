import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { buildValidatedGetCommand } from '../../src/command/get-command';
import { buildValidatedPutCommand } from '../../src/command/put-command';

const endpoint = process.env.DYNAMODB_LOCAL_ENDPOINT ?? 'http://localhost:8000';
const tableName = process.env.DYNAMODB_LOCAL_TABLE ?? 'command-builder-test';
const seedItemCount = 50;
const baseTimestamp = 1_798_000_000_000;

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
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      })
    );
  } catch (error: unknown) {
    if (!(error instanceof ResourceInUseException)) {
      throw error;
    }
  }

  await waitUntilTableExists({ client, maxWaitTime: 10, minDelay: 1, maxDelay: 2 }, { TableName: tableName });
}

async function main(): Promise<void> {
  await waitForDynamoDB();
  await createTable();

  const items = Array.from({ length: seedItemCount }, (_, index) => {
    const createdAt = baseTimestamp + index * 60_000;

    return {
      id: `local-test-${String(index + 1).padStart(3, '0')}`,
      status: index % 2 === 0 ? 'READY' : 'PENDING',
      source: 'dynamo-command-builder-v2',
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

  const allItemsAreValid = results.every(({ Item }, index) => {
    const expectedItem = items[index];

    return (
      Item?.id === expectedItem?.id &&
      typeof Item.createdAt === 'number' &&
      String(Item.createdAt).length === 13 &&
      typeof Item.updatedAt === 'number' &&
      String(Item.updatedAt).length === 13
    );
  });

  if (!allItemsAreValid || results.length !== seedItemCount) {
    throw new Error(`Expected to seed and read back ${seedItemCount} valid items.`);
  }

  console.log(`DynamoDB Local is ready at ${endpoint}.`);
  console.log(`Seeded and verified ${seedItemCount} items in table "${tableName}".`);
}

main().catch((error: unknown) => {
  console.error('Failed to seed local DynamoDB:', error);
  process.exitCode = 1;
});
