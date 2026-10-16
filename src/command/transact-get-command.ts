import { CustomTransactGetCmdInput, customTransactGetCmdInputSch } from '@/types';
import { TransactGetCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * Validates input and builds an AWS SDK DocumentClient
 * `TransactGetCommandInput`.
 *
 * ### Process Flow:
 * 1. Validate the input against the transact-get command schema.
 * 2. Convert each custom transact-get item into a DynamoDB `Get` operation.
 * 3. Preserve native JavaScript key values for the DocumentClient.
 * 4. Attach optional projection expressions and expression attribute names.
 * 5. Attach the consumed-capacity option.
 * 6. Return the validated `TransactGetCommandInput`.
 *
 * ### Notes:
 * - This builder uses `TransactGetCommandInput` from `@aws-sdk/lib-dynamodb`.
 * - Keys remain native JavaScript values and are not manually marshalled.
 * - Projection expressions and expression attribute names are scoped to each
 *   individual transactional get operation.
 * - The order of `TransactItems` is preserved.
 * - This function only constructs command input and never executes an AWS request.
 *
 * @param input The transact-get input to validate and build.
 * @returns A validated DynamoDB DocumentClient `TransactGetCommandInput`.
 * @throws If the input fails schema validation.
 */
export function buildValidatedTransactGetCommand(input: CustomTransactGetCmdInput): TransactGetCommandInput {
  try {
    const parsed = customTransactGetCmdInputSch.parse(input);

    const commandInput: TransactGetCommandInput = {
      TransactItems: parsed.transactItems.map((transactItem) => ({
        Get: {
          TableName: transactItem.tableName,
          Key: transactItem.key,

          ...(transactItem.projectionExpression
            ? {
                ProjectionExpression: transactItem.projectionExpression,
              }
            : {}),

          ...(transactItem.expressionAttributeNames && Object.keys(transactItem.expressionAttributeNames).length > 0
            ? {
                ExpressionAttributeNames: transactItem.expressionAttributeNames,
              }
            : {}),
        },
      })),

      ReturnConsumedCapacity: parsed.returnConsumedCapacity,
    };
    return commandInput;
  } catch (error: unknown) {
    console.error('Failed to build validated TransactGetCommand:', error);
    throw error;
  }
}
