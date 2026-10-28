import { dynamoKeyIdentity, dynamoKeyValueSch, dynamoPrimaryKeySch } from '../types/key.types';
import type { BatchWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { customBatchWriteCmdInputSch } from '../types';

type KeySchema = {
  partitionKey: string;
  sortKey?: string | undefined;
};
/**
 * Extracts the primary key from a record based on the provided key schema.
 *
 * ### Process flow:
 * 1. Determine the key names based on the key schema.
 * 2. If extra attributes are not allowed, check that the record contains exactly the key attributes.
 * 3. Validate that each key attribute is present and has a valid native scalar type.
 * 4. Construct and return the primary key object.
 *
 * ### Notes:
 * - The function will throw an error if the record does not conform to the key schema.
 * - String, finite numeric, bigint, and nonempty binary key values are supported.
 *
 *
 * @param record The record from which to extract the primary key.
 * @param keySchema The key schema defining the partition and sort keys.
 * @param shouldRejectExtraAttributes Whether to reject records with extra attributes beyond the key schema.
 * @returns The extracted primary key as an object.
 */
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

      if (!dynamoKeyValueSch.safeParse(value).success) {
        throw new Error(
          `Primary-key attribute "${keyName}" must be a valid string, number, bigint, or nonempty binary value.`
        );
      }

      return [keyName, value];
    })
  );
}

/**
 * Generates a stable signature for a primary key object.
 *
 * ### Notes:
 * - Keys are sorted by attribute name before hashing.
 * - The signature includes value type information to avoid collisions.
 * - This helper is used to detect duplicate item targets inside a batch.
 *
 * @param key The primary key object for a single item.
 * @returns A stable string signature representing the key.
 */
function createKeySignature(key: Record<string, unknown>): string {
  return dynamoKeyIdentity(dynamoPrimaryKeySch.parse(key));
}

/**
 * Validates custom batch-write input and builds DynamoDB command input.
 *
 * ### Process Flow:
 * 1. Validate tables and operations.
 * 2. Validate each item's primary key.
 * 3. Reject multiple operations targeting the same item.
 * 4. Build native JavaScript write requests.
 * 5. Construct the BatchWriteCommand input.
 *
 * ### Notes:
 * - This builder uses `BatchWriteCommandInput` from `@aws-sdk/lib-dynamodb`.
 * - `PutRequest.Item` values remain native JavaScript values.
 * - `DeleteRequest.Key` is derived from the provided key schema.
 * - This function only constructs command input and does not execute an AWS request.
 *
 * @example Put and delete items in one batch
 * ```ts
 * const input = buildValidatedBatchWriteCommandInput({
 *   tables: [{
 *     tableName: 'Users',
 *     keySchema: { partitionKey: 'userId' },
 *     operations: [
 *       { operation: 'PUT', item: { userId: 'user-1', name: 'Dash' } },
 *       { operation: 'DELETE', key: { userId: 'user-2' } }
 *     ]
 *   }]
 * })
 *
 * // input.RequestItems:
 * // {
 * //   Users: [
 * //     { PutRequest: { Item: { userId: 'user-1', name: 'Dash' } } },
 * //     { DeleteRequest: { Key: { userId: 'user-2' } } }
 * //   ]
 * // }
 * ```
 *
 * @param input Untrusted custom batch-write input.
 * @returns Validated DynamoDB BatchWriteCommandInput.
 */
export function buildValidatedBatchWriteCommandInput(input: unknown): BatchWriteCommandInput {
  try {
    const validatedInput = customBatchWriteCmdInputSch.parse(input);

    const requestItems: NonNullable<BatchWriteCommandInput['RequestItems']> = {};

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
              Item: write.item,
            },
          };
        }

        return {
          DeleteRequest: {
            Key: key,
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
    console.error('Failed on buildValidatedBatchWriteCommandInput:', error);
    throw error;
  }
}
