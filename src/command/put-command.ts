import { CustomPutCmdInput, customPutCmdInputSch } from '@/types';
import { extractExpAttributeNamesFromExpression } from '@/utils';
import { PutCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * Validates input and builds an AWS SDK DocumentClient `PutCommandInput`.
 *
 * ### Process Flow:
 * 1. Validate the input against the put-command schema.
 * 2. Construct the base `PutCommandInput`.
 * 3. Process the condition expression when provided.
 * 4. Generate expression attribute-name aliases from the condition.
 * 5. Merge caller-provided expression attribute names over generated aliases.
 * 6. Attach expression attribute values when provided.
 * 7. Return the validated `PutCommandInput`.
 *
 * ### Notes:
 * - This builder uses `PutCommandInput` from `@aws-sdk/lib-dynamodb`.
 * - `Item` and `ExpressionAttributeValues` remain native JavaScript values.
 * - Caller-provided `ExpressionAttributeNames` take precedence over generated aliases.
 * - `PutItem` replaces the entire existing item with the same primary key.
 * - This function only constructs command input and never executes an AWS request.
 *
 * @param input The put-item input to validate and build.
 * @returns A validated DynamoDB DocumentClient `PutCommandInput`.
 * @throws If the input fails schema validation.
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
    };

    if (!parsed.conditionExpression) {
      return commandInput;
    }

    commandInput.ConditionExpression = parsed.conditionExpression;

    const generatedExpressionAttributeNames = extractExpAttributeNamesFromExpression(parsed.conditionExpression);

    const expressionAttributeNames = {
      ...generatedExpressionAttributeNames,
      ...(parsed.expressionAttributeNames ?? {}),
    };

    if (Object.keys(expressionAttributeNames).length > 0) {
      commandInput.ExpressionAttributeNames = expressionAttributeNames;
    }

    if (parsed.expressionAttributeValues && Object.keys(parsed.expressionAttributeValues).length > 0) {
      commandInput.ExpressionAttributeValues = parsed.expressionAttributeValues;
    }

    return commandInput;
  } catch (error: unknown) {
    console.error('Failed to build validated PutCommand:', error);
    throw error;
  }
}
