import { CustomGetCmdInput, customGetCmdInputSch } from '@/types';
import { marshall } from '@/utils/marshall';
import { RESERVED_KEYWORDS_SET } from '@/utils/reserved-keywords';
import { GetItemCommandInput } from '@aws-sdk/client-dynamodb';

/**
 * Validates input and builds an AWS SDK `GetItemCommandInput`.
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
 * - Invalid input (per the schema) causes this function to throw a `ZodError`.
 *
 * ### Process Flow:
 * 1. Validate the input against the get-command schema.
 * 2. Marshall the key and construct the base `GetItemCommandInput`.
 * 3. Process the raw projection expression, aliasing reserved keywords in a single pass.
 * 4. Convert structured attribute paths into aliased DynamoDB projection paths.
 * 5. Merge projection parts and attach expression attribute names when needed.
 *
 * @param input The get-item request ({@link CustomGetCmdInput}) to validate and build.
 * @returns A validated DynamoDB `GetItemCommandInput`.
 * @throws If `input` fails schema validation.
 */
export function buildValidatedGetCommand(input: CustomGetCmdInput): GetItemCommandInput {
  try {
    const parsed = customGetCmdInputSch.parse(input);

    const commandInput: GetItemCommandInput = {
      TableName: parsed.tableName,
      Key: marshall(parsed.key),
      ConsistentRead: parsed.consistentRead,
      ReturnConsumedCapacity: parsed.returnConsumedCapacity,
    };

    const projectionParts: string[] = [];
    const expressionAttributeNames: Record<string, string> = {
      ...(parsed.expressionAttributeNames ?? {}),
    };

    // Process the raw projection expression, aliasing reserved keywords in a single regex pass
    // per part instead of matching once to detect reserved attributes and again to replace them.
    if (parsed.projectionExpression) {
      const rawProjectionParts = parsed.projectionExpression.split(',').map((part) => part.trim());

      const aliasedProjectionParts = rawProjectionParts.map((projectionPart) =>
        projectionPart.replace(/(^|\.)(?!#)([^.[\]]+)/g, (match, separator: string, attributeName: string) => {
          if (!RESERVED_KEYWORDS_SET.has(attributeName.toUpperCase())) {
            return match;
          }

          expressionAttributeNames[`#${attributeName}`] = attributeName;

          return `${separator}#${attributeName}`;
        })
      );

      projectionParts.push(aliasedProjectionParts.join(', '));
    }

    // Process structured attribute paths, generating aliases and building projection tokens.
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

    // Attach the projection expression and attribute names to the command input if any projection parts exist.
    if (projectionParts.length > 0) {
      commandInput.ProjectionExpression = projectionParts.join(', ');

      if (Object.keys(expressionAttributeNames).length > 0) {
        commandInput.ExpressionAttributeNames = expressionAttributeNames;
      }
    }

    return commandInput;
  } catch (error: unknown) {
    console.error(`Failed on buildValidatedGetCommand: ${error}`);
    throw error;
  }
}
