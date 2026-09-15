import { marshall } from '@/utils/marshall';
import type { BatchWriteItemCommandInput } from '@aws-sdk/client-dynamodb';
import { customBatchWriteCmdInputSch } from '../types';

type KeySchema = {
  partitionKey: string;
  sortKey?: string | undefined;
};

function getItemKey(
  record: Record<string, unknown>,
  keySchema: KeySchema,
  shouldRejectExtraAttributes: boolean
): Record<string, unknown> {
  const keyNames = [keySchema.partitionKey, ...(keySchema.sortKey ? [keySchema.sortKey] : [])];

  if (shouldRejectExtraAttributes) {
    const suppliedKeyNames = Object.keys(record).sort();
    const expectedKeyNames = [...keyNames].sort();

    const hasExactKeyStructure =
      suppliedKeyNames.length === expectedKeyNames.length &&
      suppliedKeyNames.every((keyName, index) => keyName === expectedKeyNames[index]);

    if (!hasExactKeyStructure) {
      throw new Error(`Delete key must contain exactly: ${expectedKeyNames.join(', ')}.`);
    }
  }

  return Object.fromEntries(
    keyNames.map((keyName) => {
      const value = record[keyName];

      if (
        !Object.prototype.hasOwnProperty.call(record, keyName) ||
        value === undefined ||
        value === null ||
        value === ''
      ) {
        throw new Error(`Missing or invalid primary-key attribute "${keyName}".`);
      }

      if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
        throw new Error(`Primary-key attribute "${keyName}" must be a string or finite number.`);
      }

      return [keyName, value];
    })
  );
}

function createKeySignature(key: Record<string, unknown>): string {
  return JSON.stringify(
    Object.entries(key)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, typeof value, value])
  );
}

/**
 * Validates custom batch-write input and builds DynamoDB command input.
 *
 * Process flow:
 * 1. Validate tables and operations.
 * 2. Validate each item's primary key.
 * 3. Reject multiple operations targeting the same item.
 * 4. Marshall native JavaScript records into DynamoDB attributes.
 * 5. Construct the BatchWriteItem command input.
 *
 * @param input Untrusted custom batch-write input.
 * @returns Validated DynamoDB BatchWriteItem command input.
 */
export function buildValidatedBatchWriteCommandInput(input: unknown): BatchWriteItemCommandInput {
  try {
    const validatedInput = customBatchWriteCmdInputSch.parse(input);

    const requestItems: NonNullable<BatchWriteItemCommandInput['RequestItems']> = {};

    for (const table of validatedInput.tables) {
      const targetedKeys = new Set<string>();

      requestItems[table.tableName] = table.operations.map((write) => {
        const sourceRecord = write.operation === 'PUT' ? write.item : write.key;

        const key = getItemKey(sourceRecord, table.keySchema, write.operation === 'DELETE');

        const keySignature = createKeySignature(key);

        if (targetedKeys.has(keySignature)) {
          throw new Error(`Multiple operations target the same item in table "${table.tableName}".`);
        }

        targetedKeys.add(keySignature);

        if (write.operation === 'PUT') {
          return {
            PutRequest: {
              Item: marshall(write.item),
            },
          };
        }

        return {
          DeleteRequest: {
            Key: marshall(key),
          },
        };
      });
    }

    return {
      RequestItems: requestItems,
      ReturnConsumedCapacity: validatedInput.returnConsumedCapacity,
      ReturnItemCollectionMetrics: validatedInput.returnItemCollectionMetrics,
    };
  } catch (error: unknown) {
    console.error(`Failed on buildValidatedBatchWriteCommandInput: ${error}`);
    throw error;
  }
}
