import { customDeleteCmdInputSch } from '@/types';
import { AttributeValue, DeleteItemCommandInput } from '@aws-sdk/client-dynamodb';

function marshall(values: Record<string, unknown>): Record<string, AttributeValue> {
  const convert = (value: unknown): AttributeValue => {
    if (value === null) return { NULL: true };
    if (typeof value === 'string') return { S: value };
    if (typeof value === 'number' || typeof value === 'bigint') return { N: value.toString() };
    if (typeof value === 'boolean') return { BOOL: value };
    if (value instanceof Uint8Array) return { B: value };
    if (Array.isArray(value)) return { L: value.map(convert) };
    if (value instanceof Set) return { L: [...value].map(convert) };
    if (typeof value === 'object') {
      return {
        M: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, convert(item)])
        ),
      };
    }
    throw new TypeError(`Unsupported DynamoDB value: ${typeof value}`);
  };

  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, convert(value)]));
}

/**
 *
 * @param input The input record to validate and build the delete command for.
 * @returns The constructed DeleteItemCommand based on the validated input.
 */
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
