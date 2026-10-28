import { dynamoKeyIdentity } from '../types/key.types';
import { CustomBatchGetCmdInput, customBatchGetCmdInputSch } from '@/types';
import { BatchGetCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * Validates custom batch-get input and constructs DynamoDB command input.
 *
 * ### Process Flow:
 * 1. Validate the request structure.
 * 2. Validate key consistency for every table.
 * 3. Reject duplicate keys.
 * 4. Build the RequestItems map using native JavaScript values.
 *
 * ### Notes:
 * - This builder uses `BatchGetCommandInput` from `@aws-sdk/lib-dynamodb`.
 * - Keys and projection settings are passed as native JavaScript values.
 * - Projection attributes are de-duplicated and always include primary-key attributes.
 * - This function only constructs command input and does not execute an AWS request.
 *
 * @example Get several users in one request
 * ```ts
 * const input = buildValidatedBatchGetCommand({
 *   tables: [{
 *     tableName: 'Users',
 *     keys: [{ userId: 'user-1' }, { userId: 'user-2' }],
 *     attributes: ['name']
 *   }]
 * })
 *
 * // input:
 * // {
 * //   RequestItems: {
 * //     Users: {
 * //       Keys: [{ userId: 'user-1' }, { userId: 'user-2' }],
 * //       ConsistentRead: false,
 * //       ProjectionExpression: '#attr0, #attr1',
 * //       ExpressionAttributeNames: { '#attr0': 'userId', '#attr1': 'name' }
 * //     }
 * //   },
 * //   ReturnConsumedCapacity: 'NONE'
 * // }
 * ```
 *
 * @param input The untrusted input to validate.
 * @returns The constructed BatchGetCommandInput.
 */
export function buildValidatedBatchGetCommand(input: CustomBatchGetCmdInput): BatchGetCommandInput {
  try {
    const validatedInput = customBatchGetCmdInputSch.parse(input);
    const requestItems: NonNullable<BatchGetCommandInput['RequestItems']> = {};

    for (const table of validatedInput.tables) {
      const firstKey = table.keys[0];

      if (!firstKey) {
        throw new Error(`No keys provided for table "${table.tableName}".`);
      }

      const keyNames = Object.keys(firstKey).sort();

      if (keyNames.length < 1 || keyNames.length > 2) {
        throw new Error(`Keys for table "${table.tableName}" must contain one or two attributes.`);
      }

      const seenKeys = new Set<string>();

      for (const [keyIndex, key] of table.keys.entries()) {
        const currentKeyNames = Object.keys(key).sort();

        const hasSameKeyStructure =
          currentKeyNames.length === keyNames.length &&
          currentKeyNames.every((name, index) => name === keyNames[index]);

        if (!hasSameKeyStructure) {
          throw new Error(
            `Key at index ${keyIndex} for table "${table.tableName}" ` +
              'does not have the same primary-key attributes as the other keys.'
          );
        }

        for (const keyName of keyNames) {
          if (
            (typeof key[keyName] === 'bigint' ? 'number' : typeof key[keyName]) !==
            (typeof firstKey[keyName] === 'bigint' ? 'number' : typeof firstKey[keyName])
          ) {
            throw new Error(
              `Key attribute "${keyName}" has inconsistent value types ` + `in table "${table.tableName}".`
            );
          }
        }

        const signature = dynamoKeyIdentity(key);

        if (seenKeys.has(signature)) {
          throw new Error(`Duplicate key found for table "${table.tableName}".`);
        }

        seenKeys.add(signature);
      }

      const projectedAttributes = table.attributes ? [...new Set([...keyNames, ...table.attributes])] : undefined;

      const expressionAttributeNames = projectedAttributes
        ? Object.fromEntries(projectedAttributes.map((name, index) => [`#attr${index}`, name]))
        : undefined;

      const projectionExpression = projectedAttributes?.map((_, index) => `#attr${index}`).join(', ');

      requestItems[table.tableName] = {
        Keys: table.keys,
        ConsistentRead: table.consistentRead,

        ...(projectionExpression && {
          ProjectionExpression: projectionExpression,
          ExpressionAttributeNames: expressionAttributeNames,
        }),
      };
    }

    return {
      RequestItems: requestItems,
      ReturnConsumedCapacity: validatedInput.returnConsumedCapacity,
    };
  } catch (error: unknown) {
    console.error('Failed on buildValidatedBatchGetCommandInput:', error);
    throw error;
  }
}
