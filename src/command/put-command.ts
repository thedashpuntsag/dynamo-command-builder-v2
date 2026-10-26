import { CustomPutCmdInput, customPutCmdInputSch } from '@/types';
import { extractExpAttributeNamesFromExpression } from '@/utils';
import type { PutCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * Validates input and builds an AWS SDK DocumentClient `PutCommandInput`.
 *
 * ### Process Flow:
 * 1. Validate input against the put-command schema.
 * 2. Construct the base `PutCommandInput`.
 * 3. Extract referenced attribute-name and value tokens from the condition.
 * 4. Generate attribute-name aliases and merge caller-provided mappings.
 * 5. Remove unused expression attribute names and values.
 * 6. Validate that every referenced token has a corresponding mapping.
 * 7. Attach conditional expressions and response options.
 * 8. Return the validated `PutCommandInput`.
 *
 * ### Notes:
 * - Uses native JavaScript values through `@aws-sdk/lib-dynamodb`.
 * - Caller-provided aliases override automatically generated mappings.
 * - Unused expression attribute names and values are silently omitted.
 * - Missing referenced expression values cause an error.
 * - PutItem replaces the entire existing item with the same primary key.
 * - This function never executes an AWS request.
 *
 * @example Create an item only when its key does not exist
 * ```ts
 * const input = buildValidatedPutCommand({
 *   tableName: 'Users',
 *   item: { userId: 'user-1', name: 'Dash' },
 *   conditionExpression: 'attribute_not_exists(#userId)'
 * })
 *
 * // input:
 * // {
 * //   TableName: 'Users',
 * //   Item: { userId: 'user-1', name: 'Dash' },
 * //   ConditionExpression: 'attribute_not_exists(#userId)',
 * //   ExpressionAttributeNames: { '#userId': 'userId' },
 * //   ReturnValues: 'NONE',
 * //   ReturnConsumedCapacity: 'NONE',
 * //   ReturnItemCollectionMetrics: 'NONE',
 * //   ReturnValuesOnConditionCheckFailure: 'NONE'
 * // }
 * ```
 *
 * @param input The put-item request to validate and build.
 * @returns A validated DynamoDB DocumentClient `PutCommandInput`.
 * @throws If input validation or expression-token validation fails.
 */
export function buildValidatedPutCommand(input: CustomPutCmdInput): PutCommandInput {
  try {
    const parsed = customPutCmdInputSch.parse(input);

    const commandInput: PutCommandInput = {
      TableName: parsed.tableName,
      Item: parsed.item,
      ReturnValues: parsed.returnValues,
      ReturnConsumedCapacity: parsed.returnConsumedCapacity,
      ReturnItemCollectionMetrics: parsed.returnItemCollectionMetrics,
      ReturnValuesOnConditionCheckFailure: parsed.returnValuesOnConditionCheckFailure,
    };

    if (!parsed.conditionExpression) {
      return commandInput;
    }

    const conditionExpression = parsed.conditionExpression;

    const referencedNames = new Set(conditionExpression.match(/#[A-Za-z0-9_]+/g) ?? []);

    const referencedValues = new Set(conditionExpression.match(/:[A-Za-z0-9_]+/g) ?? []);

    const generatedNames = extractExpAttributeNamesFromExpression(conditionExpression);

    const providedNames = parsed.expressionAttributeNames ?? {};
    const providedValues = parsed.expressionAttributeValues ?? {};

    const mergedNames: Record<string, string> = {
      ...generatedNames,
      ...providedNames,
    };

    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    // After generating / merging names
    for (const token of referencedNames) {
      if (!Object.hasOwn(mergedNames, token)) {
        throw new Error(`Missing expression attribute name: "${token}".`);
      }
      expressionAttributeNames[token] = mergedNames[token]!; // safe after hasOwn
    }

    // Values stay the same (caller-provided only)
    for (const token of referencedValues) {
      if (!Object.hasOwn(providedValues, token)) {
        throw new Error(`Missing expression attribute value: "${token}".`);
      }
      expressionAttributeValues[token] = providedValues[token];
    }

    commandInput.ConditionExpression = conditionExpression;

    if (Object.keys(expressionAttributeNames).length > 0) {
      commandInput.ExpressionAttributeNames = expressionAttributeNames;
    }

    if (Object.keys(expressionAttributeValues).length > 0) {
      commandInput.ExpressionAttributeValues = expressionAttributeValues;
    }

    return commandInput;
  } catch (error: unknown) {
    console.error('Failed to build validated PutCommand:', error);
    throw error;
  }
}
