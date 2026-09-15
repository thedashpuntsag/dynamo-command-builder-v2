import { CustomGetCmdInput, customGetCmdInputSch } from '@/types';
import { marshall } from '@/utils/marshall';
import { replaceReservedKeywordsFromProjection, RESERVED_KEYWORDS_SET } from '@/utils/reserved-keywords';
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
 * ### Process Flow:
 * 1. Validate the input against the get-command schema.
 * 2. Marshall the key and construct the base `GetItemCommandInput`.
 * 3. Process the raw projection expression, replacing reserved keywords with aliases.
 * 4. Convert structured attribute paths into aliased DynamoDB projection paths.
 * 5. Merge projection parts and attach expression attribute names when needed.
 *
 * @param input The get-item request to validate and build.
 * @returns A validated DynamoDB `GetItemCommandInput`.
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

    // Process the raw projection expression, replacing reserved keywords with aliases.
    if (parsed.projectionExpression) {
      const rawProjectionParts = parsed.projectionExpression.split(',').map((part) => part.trim());

      rawProjectionParts.forEach((projectionPart) => {
        const reservedAttributes = projectionPart.match(/(?:^|\.)(?!#)([^.[\]]+)/g) ?? [];

        reservedAttributes.forEach((attribute) => {
          const attributeName = attribute.replace(/^\./, '');

          if (RESERVED_KEYWORDS_SET.has(attributeName.toUpperCase())) {
            expressionAttributeNames[`#${attributeName}`] = attributeName;
          }
        });
      });

      projectionParts.push(replaceReservedKeywordsFromProjection(parsed.projectionExpression));
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
