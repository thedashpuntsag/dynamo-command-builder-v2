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
 * 4. Generate projections from structured attribute paths or advanced raw expressions.
 * 5. Attach the consumed-capacity option.
 * 6. Return the validated `TransactGetCommandInput`.
 *
 * ### Notes:
 * - This builder uses `TransactGetCommandInput` from `@aws-sdk/lib-dynamodb`.
 * - Keys remain native JavaScript values and are not manually marshalled.
 * - Structured `attributes` generate projection expressions and aliases automatically.
 * - Raw projection expressions and expression attribute names are scoped to each
 *   individual transactional get operation.
 * - The order of `TransactItems` is preserved.
 * - This function only constructs command input and never executes an AWS request.
 *
 * @example Read two items atomically
 * ```ts
 * const input = buildValidatedTransactGetCommand({
 *   transactItems: [
 *     { tableName: 'Users', key: { userId: 'user-1' } },
 *     { tableName: 'Accounts', key: { accountId: 'account-1' } }
 *   ]
 * })
 *
 * // input:
 * // {
 * //   TransactItems: [
 * //     { Get: { TableName: 'Users', Key: { userId: 'user-1' } } },
 * //     { Get: { TableName: 'Accounts', Key: { accountId: 'account-1' } } }
 * //   ],
 * //   ReturnConsumedCapacity: 'NONE'
 * // }
 * ```
 *
 * @param input The transact-get input to validate and build.
 * @returns A validated DynamoDB DocumentClient `TransactGetCommandInput`.
 * @throws If the input fails schema validation.
 */
export function buildValidatedTransactGetCommand(input: CustomTransactGetCmdInput): TransactGetCommandInput {
  try {
    const parsed = customTransactGetCmdInputSch.parse(input);

    const commandInput: TransactGetCommandInput = {
      TransactItems: parsed.transactItems.map((transactItem) => {
        const projectionParts = transactItem.projectionExpression ? [transactItem.projectionExpression] : [];
        const expressionAttributeNames = { ...transactItem.expressionAttributeNames };
        const tokensByName = new Map<string, string>();
        let nextToken = 0;

        for (const attributePath of new Set(transactItem.attributes ?? [])) {
          const parts = attributePath.match(/[^.[\]]+|\[\d+\]/g) ?? [];
          projectionParts.push(
            parts
              .map((part) => {
                if (part.startsWith('[')) return part;
                let token = tokensByName.get(part);
                if (token) return token;
                token = `#attr${nextToken++}`;
                while (token in expressionAttributeNames) token = `#attr${nextToken++}`;
                tokensByName.set(part, token);
                expressionAttributeNames[token] = part;
                return token;
              })
              .reduce((path, part, index) => `${path}${index > 0 && !part.startsWith('[') ? '.' : ''}${part}`, '')
          );
        }

        return {
          Get: {
            TableName: transactItem.tableName,
            Key: transactItem.key,
            ...(projectionParts.length > 0 && { ProjectionExpression: projectionParts.join(', ') }),
            ...(Object.keys(expressionAttributeNames).length > 0 && {
              ExpressionAttributeNames: expressionAttributeNames,
            }),
          },
        };
      }),

      ReturnConsumedCapacity: parsed.returnConsumedCapacity,
    };
    return commandInput;
  } catch (error: unknown) {
    console.error('Failed to build validated TransactGetCommand:', error);
    throw error;
  }
}
