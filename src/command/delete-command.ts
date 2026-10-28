import { compileStructuredCondition } from '../utils/condition-expression';
import { customDeleteCmdInputSch } from '@/types';
import type { DeleteCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * Validates custom delete input and builds DynamoDB command input.
 *
 * ### Process Flow:
 * 1. Validate the table, primary key, condition and return options.
 * 2. Verify that expression placeholders have matching definitions.
 * 3. Use native JavaScript key and expression values.
 * 4. Construct the DeleteCommandInput.
 *
 * ### Notes:
 * - This builder uses `DeleteCommandInput` from `@aws-sdk/lib-dynamodb`.
 * - `Key` and `ExpressionAttributeValues` remain native JavaScript values.
 * - Caller-provided expression attributes are passed through without evaluation.
 * - This function only constructs command input and does not execute an AWS request.
 *
 * @example Conditionally delete an item
 * ```ts
 * const input = buildValidatedDeleteCommandInput({
 *   tableName: 'Users',
 *   key: { userId: 'user-1' },
 *   conditionExpression: '#status = :status',
 *   expressionAttributeNames: { '#status': 'status' },
 *   expressionAttributeValues: { ':status': 'INACTIVE' }
 * })
 *
 * // input:
 * // {
 * //   TableName: 'Users',
 * //   Key: { userId: 'user-1' },
 * //   ConditionExpression: '#status = :status',
 * //   ExpressionAttributeNames: { '#status': 'status' },
 * //   ExpressionAttributeValues: { ':status': 'INACTIVE' },
 * //   ReturnValues: 'NONE'
 * // }
 * ```
 *
 * @param input Untrusted custom delete-command input.
 * @returns Validated DynamoDB DeleteCommand input.
 */
export function buildValidatedDeleteCommandInput(input: unknown): DeleteCommandInput {
  try {
    const validatedInput = customDeleteCmdInputSch.parse(input);

    const compiled = compileStructuredCondition(validatedInput);

    return {
      TableName: validatedInput.tableName,
      Key: validatedInput.key,
      ReturnValues: validatedInput.returnValues,
      ReturnValuesOnConditionCheckFailure: validatedInput.returnValuesOnConditionCheckFailure,
      ReturnConsumedCapacity: validatedInput.returnConsumedCapacity,
      ReturnItemCollectionMetrics: validatedInput.returnItemCollectionMetrics,

      ...(compiled && {
        ConditionExpression: compiled.expression,
        ExpressionAttributeNames: compiled.expressionAttributeNames,
        ...(Object.keys(compiled.expressionAttributeValues).length > 0 && {
          ExpressionAttributeValues: compiled.expressionAttributeValues,
        }),
      }),
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
