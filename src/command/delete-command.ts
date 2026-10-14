import { customDeleteCmdInputSch } from '@/types';
import type { DeleteCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * Validates custom delete input and builds DynamoDB command input.
 *
 * Process flow:
 * 1. Validate the table, primary key, condition and return options.
 * 2. Verify that expression placeholders have matching definitions.
 * 3. Use native JavaScript key and expression values.
 * 4. Construct the DeleteCommandInput.
 *
 * @param input Untrusted custom delete-command input.
 * @returns Validated DynamoDB DeleteCommand input.
 */
export function buildValidatedDeleteCommandInput(input: unknown): DeleteCommandInput {
  try {
    const validatedInput = customDeleteCmdInputSch.parse(input);

    return {
      TableName: validatedInput.tableName,
      Key: validatedInput.key,
      ReturnValues: validatedInput.returnValues,
      ReturnValuesOnConditionCheckFailure: validatedInput.returnValuesOnConditionCheckFailure,
      ReturnConsumedCapacity: validatedInput.returnConsumedCapacity,
      ReturnItemCollectionMetrics: validatedInput.returnItemCollectionMetrics,

      ...(validatedInput.conditionExpression && {
        ConditionExpression: validatedInput.conditionExpression,
      }),

      ...(validatedInput.expressionAttributeNames && {
        ExpressionAttributeNames: validatedInput.expressionAttributeNames,
      }),

      ...(validatedInput.expressionAttributeValues && {
        ExpressionAttributeValues: validatedInput.expressionAttributeValues,
      }),
    };
  } catch (error: unknown) {
    console.error('Failed on buildValidatedDeleteCommandInput:', error);
    throw error;
  }
}
