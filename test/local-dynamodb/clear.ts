import { DynamoDBClient, ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, ScanCommand, type ScanCommandOutput } from '@aws-sdk/lib-dynamodb';

import { buildValidatedDeleteCommandInput } from '../../src/command/delete-command';
import { buildValidatedScanCommand } from '../../src/command/scan-command';

const endpoint = process.env.DYNAMODB_LOCAL_ENDPOINT ?? 'http://localhost:8000';
const tableName = process.env.DYNAMODB_LOCAL_TABLE ?? 'command-builder-test';

const client = new DynamoDBClient({
  endpoint,
  region: 'local',
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local',
  },
});
const documentClient = DynamoDBDocumentClient.from(client);

async function main(): Promise<void> {
  let lastEvaluatedKey: ScanCommandOutput['LastEvaluatedKey'];
  let deletedCount = 0;

  try {
    do {
      const page = await documentClient.send(
        new ScanCommand(
          buildValidatedScanCommand({
            tableName,
            projectionExpression: '#id',
            expressionAttributeNames: { '#id': 'id' },
            ...(lastEvaluatedKey && { exclusiveStartKey: lastEvaluatedKey }),
            consistentRead: true,
            limit: 25,
          })
        )
      );

      await Promise.all(
        (page.Items ?? []).map(async (item) => {
          await documentClient.send(
            new DeleteCommand(
              buildValidatedDeleteCommandInput({
                tableName,
                key: { id: item.id },
              })
            )
          );
          deletedCount += 1;
        })
      );

      lastEvaluatedKey = page.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    console.log(`Cleared ${deletedCount} items from table "${tableName}" at ${endpoint}.`);
  } catch (error: unknown) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }

    console.log(`Table "${tableName}" does not exist at ${endpoint}; nothing to clear.`);
  } finally {
    client.destroy();
  }
}

main().catch((error: unknown) => {
  console.error('Failed to clear local DynamoDB:', error);
  process.exitCode = 1;
});
