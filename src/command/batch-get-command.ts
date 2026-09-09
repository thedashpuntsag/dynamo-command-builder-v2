import { CustomBatchGetCmdInput, customBatchGetCmdInputSch } from '@/types';
import { AttributeValue, BatchGetItemCommandInput } from '@aws-sdk/client-dynamodb';

/**
 * Validates custom batch-get input and constructs DynamoDB command input.
 *
 * Process flow:
 * 1. Validate the request structure.
 * 2. Validate key consistency for every table.
 * 3. Reject duplicate keys.
 * 4. Convert native key values into DynamoDB AttributeValue objects.
 * 5. Build the RequestItems map.
 *
 * @param input The untrusted input to validate.
 * @returns The constructed BatchGetItemCommandInput.
 */
export function buildValidatedBatchGetCommand(input: CustomBatchGetCmdInput): BatchGetItemCommandInput {
  const validatedInput = customBatchGetCmdInputSch.parse(input);
  const requestItems: NonNullable<BatchGetItemCommandInput['RequestItems']> = {};

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

    const keys = table.keys.map((key, keyIndex) => {
      const currentKeyNames = Object.keys(key).sort();

      const hasSameKeyStructure =
        currentKeyNames.length === keyNames.length &&
        currentKeyNames.every((keyName, index) => keyName === keyNames[index]);

      if (!hasSameKeyStructure) {
        throw new Error(
          `Key at index ${keyIndex} for table "${table.tableName}" ` +
            'does not have the same primary-key attributes as the other keys.'
        );
      }

      for (const keyName of keyNames) {
        if (typeof key[keyName] !== typeof firstKey[keyName]) {
          throw new Error(
            `Key attribute "${keyName}" has inconsistent value types ` + `in table "${table.tableName}".`
          );
        }
      }

      const signature = JSON.stringify(keyNames.map((keyName) => [keyName, typeof key[keyName], key[keyName]]));

      if (seenKeys.has(signature)) {
        throw new Error(`Duplicate key found for table "${table.tableName}".`);
      }

      seenKeys.add(signature);

      return Object.fromEntries(
        Object.entries(key).map(([attributeName, value]): [string, AttributeValue] => [
          attributeName,
          typeof value === 'string' ? { S: value } : { N: String(value) },
        ])
      );
    });

    /*
     * Include primary-key attributes because BatchGetItem does not
     * guarantee response order. The caller needs keys to match results
     * with requested items.
     */
    const projectedAttributes = table.attributes ? [...new Set([...keyNames, ...table.attributes])] : undefined;

    const expressionAttributeNames = projectedAttributes
      ? Object.fromEntries(projectedAttributes.map((attributeName, index) => [`#attr${index}`, attributeName]))
      : undefined;

    const projectionExpression = projectedAttributes?.map((_, index) => `#attr${index}`).join(', ');

    requestItems[table.tableName] = {
      Keys: keys,
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
}
