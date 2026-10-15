import { CustomGetCmdInput, customGetCmdInputSch } from '@/types';
import { RESERVED_KEYWORDS_SET } from '@/utils/reserved-keywords';
import { GetCommandInput } from '@aws-sdk/lib-dynamodb';

/**
 * Validates input and builds an AWS SDK DocumentClient `GetCommandInput`.
 *
 * Projection fields can be supplied in either or both forms:
 * - `projectionExpression` accepts a raw DynamoDB projection expression and optional aliases.
 * - `attributes` accepts structured paths such as `profile.name` and `items[0].status`.
 *
 * Both forms are merged when provided. Structured paths receive generated aliases, and
 * reserved keywords in raw projection paths are aliased automatically.
 *
 * Defaults and constraints enforced by {@link customGetCmdInputSch}:
 * - `consistentRead` defaults to `false` when not provided.
 * - `expressionAttributeNames` is only accepted alongside a `projectionExpression`.
 * - Invalid input causes this function to throw a `ZodError`.
 *
 * ### Process Flow:
 * 1. Validate the input against the get-command schema.
 * 2. Construct the base DocumentClient `GetCommandInput`.
 * 3. Process the raw projection expression and alias reserved keywords.
 * 4. Validate generated aliases against caller-provided aliases.
 * 5. Convert structured attribute paths into aliased DynamoDB projection paths.
 * 6. Merge projection parts and attach expression attribute names when needed.
 *
 * ### Notes:
 * - This builder uses `GetCommandInput` from `@aws-sdk/lib-dynamodb`.
 * - `Key` remains a native JavaScript object and is not manually marshalled.
 * - This function only constructs command input and does not execute an AWS request.
 *
 * @param input The get-item request to validate and build.
 * @returns A validated DynamoDB DocumentClient `GetCommandInput`.
 * @throws If `input` fails schema validation or an expression alias conflicts.
 */
export function buildValidatedGetCommand(input: CustomGetCmdInput): GetCommandInput {
  try {
    const parsed = customGetCmdInputSch.parse(input);

    const commandInput: GetCommandInput = {
      TableName: parsed.tableName,
      Key: parsed.key,
      ConsistentRead: parsed.consistentRead,
      ReturnConsumedCapacity: parsed.returnConsumedCapacity,
    };

    const projectionParts: string[] = [];

    const expressionAttributeNames: Record<string, string> = {
      ...parsed.expressionAttributeNames,
    };

    if (parsed.projectionExpression) {
      const rawProjectionParts = parsed.projectionExpression
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

      const aliasedProjectionParts = rawProjectionParts.map((projectionPart) =>
        projectionPart.replace(/(^|\.)(?!#)([^.[\]]+)/g, (match, separator: string, attributeName: string) => {
          if (!RESERVED_KEYWORDS_SET.has(attributeName.toUpperCase())) {
            return match;
          }

          const token = `#${attributeName}`;
          const existingMapping = expressionAttributeNames[token];

          if (existingMapping !== undefined && existingMapping !== attributeName) {
            throw new Error(
              `Expression attribute name token "${token}" conflicts with existing mapping "${existingMapping}".`
            );
          }

          expressionAttributeNames[token] = attributeName;

          return `${separator}${token}`;
        })
      );

      projectionParts.push(...aliasedProjectionParts);
    }

    if (parsed.attributes) {
      const attributeNameTokens = new Map<string, string>();
      let nextTokenIndex = 0;

      const getNextToken = (): string => {
        let token = `#attr${nextTokenIndex++}`;

        while (token in expressionAttributeNames) {
          token = `#attr${nextTokenIndex++}`;
        }

        return token;
      };

      const projectionTokens = [...new Set(parsed.attributes)].map((attributePath) => {
        const pathParts = attributePath.match(/[^.[\]]+|\[\d+\]/g) ?? [];

        return pathParts
          .map((pathPart) => {
            if (pathPart.startsWith('[')) {
              return pathPart;
            }

            let token = attributeNameTokens.get(pathPart);

            if (!token) {
              token = getNextToken();

              attributeNameTokens.set(pathPart, token);
              expressionAttributeNames[token] = pathPart;
            }

            return token;
          })
          .reduce((path, part, index) => `${path}${index > 0 && !part.startsWith('[') ? '.' : ''}${part}`, '');
      });

      projectionParts.push(...projectionTokens);
    }

    if (projectionParts.length > 0) {
      commandInput.ProjectionExpression = projectionParts.join(', ');

      if (Object.keys(expressionAttributeNames).length > 0) {
        commandInput.ExpressionAttributeNames = expressionAttributeNames;
      }
    }

    return commandInput;
  } catch (error: unknown) {
    console.error('Failed on buildValidatedGetCommand:', error);
    throw error;
  }
}
