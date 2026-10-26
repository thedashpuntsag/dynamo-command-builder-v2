import { CustomTransactWriteCmdInput, customTransactWriteCmdInputSch } from '@/types';
import { extractExpAttributeNamesFromExpression } from '@/utils';
import { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * Validates input and builds an AWS SDK DocumentClient
 * `TransactWriteCommandInput`.
 *
 * ### Process Flow:
 * 1. Validate the input against the transact-write command schema.
 * 2. Convert each custom transact item into a DynamoDB transactional operation.
 * 3. Preserve native JavaScript values for `Item`, `Key`, and expression values.
 * 4. Generate expression attribute-name aliases from condition expressions.
 * 5. Merge caller-provided expression attribute names over generated aliases.
 * 6. Attach transaction-level response options.
 * 7. Return the validated `TransactWriteCommandInput`.
 *
 * ### Supported Operations:
 * - `PUT` creates or replaces an item.
 * - `UPDATE` modifies an existing item using an update expression.
 * - `DELETE` deletes an item by its primary key.
 * - `CONDITION_CHECK` validates an item without modifying it.
 *
 * ### Notes:
 * - This builder uses `TransactWriteCommandInput` from `@aws-sdk/lib-dynamodb`.
 * - `Item`, `Key`, and `ExpressionAttributeValues` remain native JavaScript values.
 * - Caller-provided expression attribute names take precedence over generated aliases.
 * - DynamoDB executes the transaction atomically: either all operations succeed or
 *   the transaction is cancelled.
 * - This function only constructs command input and never executes an AWS request.
 *
 * @example Write and delete items atomically
 * ```ts
 * const input = buildValidatedTransactWriteCommand({
 *   transactItems: [
 *     { operation: 'PUT', tableName: 'Users', item: { userId: 'user-1', name: 'Dash' } },
 *     { operation: 'DELETE', tableName: 'Invites', key: { inviteId: 'invite-1' } }
 *   ]
 * })
 *
 * // input.TransactItems:
 * // [
 * //   { Put: { TableName: 'Users', Item: { userId: 'user-1', name: 'Dash' } } },
 * //   { Delete: { TableName: 'Invites', Key: { inviteId: 'invite-1' } } }
 * // ]
 * ```
 *
 * @param input The transact-write input to validate and build.
 * @returns A validated DynamoDB DocumentClient `TransactWriteCommandInput`.
 * @throws If the input fails schema validation.
 */
export function buildValidatedTransactWriteCommand(input: CustomTransactWriteCmdInput): TransactWriteCommandInput {
  try {
    const parsed = customTransactWriteCmdInputSch.parse(input);

    const commandInput: TransactWriteCommandInput = {
      TransactItems: parsed.transactItems.map((transactItem) => {
        switch (transactItem.operation) {
          case 'PUT': {
            const generatedExpressionAttributeNames = transactItem.conditionExpression
              ? extractExpAttributeNamesFromExpression(transactItem.conditionExpression)
              : {};

            const expressionAttributeNames = {
              ...generatedExpressionAttributeNames,
              ...transactItem.expressionAttributeNames,
            };

            return {
              Put: {
                TableName: transactItem.tableName,
                Item: transactItem.item,

                ...(transactItem.conditionExpression
                  ? {
                      ConditionExpression: transactItem.conditionExpression,
                    }
                  : {}),

                ...(Object.keys(expressionAttributeNames).length > 0
                  ? {
                      ExpressionAttributeNames: expressionAttributeNames,
                    }
                  : {}),

                ...(transactItem.expressionAttributeValues &&
                Object.keys(transactItem.expressionAttributeValues).length > 0
                  ? {
                      ExpressionAttributeValues: transactItem.expressionAttributeValues,
                    }
                  : {}),

                ...(transactItem.returnValuesOnConditionCheckFailure
                  ? {
                      ReturnValuesOnConditionCheckFailure: transactItem.returnValuesOnConditionCheckFailure,
                    }
                  : {}),
              },
            };
          }

          case 'UPDATE': {
            const conditionExpressionAttributeNames = transactItem.conditionExpression
              ? extractExpAttributeNamesFromExpression(transactItem.conditionExpression)
              : {};

            const updateExpressionAttributeNames = extractExpAttributeNamesFromExpression(
              transactItem.updateExpression
            );

            const expressionAttributeNames = {
              ...updateExpressionAttributeNames,
              ...conditionExpressionAttributeNames,
              ...transactItem.expressionAttributeNames,
            };

            return {
              Update: {
                TableName: transactItem.tableName,
                Key: transactItem.key,
                UpdateExpression: transactItem.updateExpression,

                ...(transactItem.conditionExpression
                  ? {
                      ConditionExpression: transactItem.conditionExpression,
                    }
                  : {}),

                ...(Object.keys(expressionAttributeNames).length > 0
                  ? {
                      ExpressionAttributeNames: expressionAttributeNames,
                    }
                  : {}),

                ...(transactItem.expressionAttributeValues &&
                Object.keys(transactItem.expressionAttributeValues).length > 0
                  ? {
                      ExpressionAttributeValues: transactItem.expressionAttributeValues,
                    }
                  : {}),

                ...(transactItem.returnValuesOnConditionCheckFailure
                  ? {
                      ReturnValuesOnConditionCheckFailure: transactItem.returnValuesOnConditionCheckFailure,
                    }
                  : {}),
              },
            };
          }

          case 'DELETE': {
            const generatedExpressionAttributeNames = transactItem.conditionExpression
              ? extractExpAttributeNamesFromExpression(transactItem.conditionExpression)
              : {};

            const expressionAttributeNames = {
              ...generatedExpressionAttributeNames,
              ...transactItem.expressionAttributeNames,
            };

            return {
              Delete: {
                TableName: transactItem.tableName,
                Key: transactItem.key,

                ...(transactItem.conditionExpression
                  ? {
                      ConditionExpression: transactItem.conditionExpression,
                    }
                  : {}),

                ...(Object.keys(expressionAttributeNames).length > 0
                  ? {
                      ExpressionAttributeNames: expressionAttributeNames,
                    }
                  : {}),

                ...(transactItem.expressionAttributeValues &&
                Object.keys(transactItem.expressionAttributeValues).length > 0
                  ? {
                      ExpressionAttributeValues: transactItem.expressionAttributeValues,
                    }
                  : {}),

                ...(transactItem.returnValuesOnConditionCheckFailure
                  ? {
                      ReturnValuesOnConditionCheckFailure: transactItem.returnValuesOnConditionCheckFailure,
                    }
                  : {}),
              },
            };
          }

          case 'CONDITION_CHECK': {
            const generatedExpressionAttributeNames = extractExpAttributeNamesFromExpression(
              transactItem.conditionExpression
            );

            const expressionAttributeNames = {
              ...generatedExpressionAttributeNames,
              ...transactItem.expressionAttributeNames,
            };

            return {
              ConditionCheck: {
                TableName: transactItem.tableName,
                Key: transactItem.key,
                ConditionExpression: transactItem.conditionExpression,

                ...(Object.keys(expressionAttributeNames).length > 0
                  ? {
                      ExpressionAttributeNames: expressionAttributeNames,
                    }
                  : {}),

                ...(transactItem.expressionAttributeValues &&
                Object.keys(transactItem.expressionAttributeValues).length > 0
                  ? {
                      ExpressionAttributeValues: transactItem.expressionAttributeValues,
                    }
                  : {}),

                ...(transactItem.returnValuesOnConditionCheckFailure
                  ? {
                      ReturnValuesOnConditionCheckFailure: transactItem.returnValuesOnConditionCheckFailure,
                    }
                  : {}),
              },
            };
          }
        }
      }),

      ReturnConsumedCapacity: parsed.returnConsumedCapacity,
      ReturnItemCollectionMetrics: parsed.returnItemCollectionMetrics,

      ...(parsed.clientRequestToken
        ? {
            ClientRequestToken: parsed.clientRequestToken,
          }
        : {}),
    };

    return commandInput;
  } catch (error: unknown) {
    console.error('Failed to build validated TransactWriteCommand:', error);

    throw error;
  }
}
