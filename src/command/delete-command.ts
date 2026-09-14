import { customDeleteCmdInputSch } from '@/types';
import { marshall } from '@/utils/marshall';
import { DeleteItemCommandInput } from '@aws-sdk/client-dynamodb';

/**
 * Validates custom delete input and builds DynamoDB command input.
 *
 * Process flow:
 * 1. Validate the table, primary key, condition and return options.
 * 2. Verify that expression placeholders have matching definitions.
 * 3. Marshall native key and expression values.
 * 4. Construct the DeleteItemCommandInput.
 *
 * @param input Untrusted custom delete-command input.
 * @returns Validated DynamoDB DeleteItem command input.
 */
export function buildValidatedDeleteCommandInput(input: unknown): DeleteItemCommandInput {
  const validatedInput = customDeleteCmdInputSch.parse(input);

  return {
    TableName: validatedInput.tableName,
    Key: marshall(validatedInput.key),
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
      ExpressionAttributeValues: marshall(validatedInput.expressionAttributeValues),
    }),
  };
}
