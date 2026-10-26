import { CustomScanCmdInput, customScanCmdInputSch } from '@/types';
import { extractExpAttributeNamesFromExpression } from '@/utils';
import type { ScanCommandInput } from '@aws-sdk/lib-dynamodb';

type ExpressionTokens = {
  names: Set<string>;
  values: Set<string>;
};

/**
 * Extracts attribute-name and attribute-value placeholders from
 * DynamoDB expressions.
 *
 * Note: This is lightweight token extraction, not a complete
 * DynamoDB expression parser.
 */
function extractExpressionTokens(expressions: string[]): ExpressionTokens {
  const names = new Set<string>();
  const values = new Set<string>();

  for (const expression of expressions) {
    for (const token of expression.match(/#[A-Za-z0-9_]+/g) ?? []) {
      names.add(token);
    }

    for (const token of expression.match(/:[A-Za-z0-9_]+/g) ?? []) {
      values.add(token);
    }
  }

  return { names, values };
}

/**
 * Validates input and builds an AWS SDK DocumentClient `ScanCommandInput`.
 *
 * ### Process Flow:
 * 1. Validate input against the scan-command schema.
 * 2. Construct the base `ScanCommandInput`.
 * 3. Attach optional scan, pagination, and index parameters.
 * 4. Collect tokens referenced by filter and projection expressions.
 * 5. Infer attribute-name aliases from the expressions.
 * 6. Merge caller-provided aliases over inferred mappings.
 * 7. Remove unused expression attribute names and values.
 * 8. Reject referenced tokens without valid mappings.
 * 9. Return the validated `ScanCommandInput`.
 *
 * ### Notes:
 * - Uses `@aws-sdk/lib-dynamodb` with native JavaScript values.
 * - Caller-provided aliases override automatically inferred mappings.
 * - Unused expression mappings are silently ignored.
 * - Referenced expression values must be defined.
 * - Missing attribute-name aliases are inferred using library conventions.
 * - Full DynamoDB expression grammar is not validated.
 * - FilterExpression is applied after DynamoDB reads items.
 * - Limit controls items evaluated, not necessarily items returned.
 * - Does not execute AWS requests.
 *
 * @example Scan an index with a filter
 * ```ts
 * const input = buildValidatedScanCommand({
 *   tableName: 'Orders',
 *   indexName: 'byStatus',
 *   filterExpression: '#status = :status',
 *   expressionAttributeValues: { ':status': 'ACTIVE' },
 *   limit: 25
 * })
 *
 * // input:
 * // {
 * //   TableName: 'Orders',
 * //   IndexName: 'byStatus',
 * //   FilterExpression: '#status = :status',
 * //   ExpressionAttributeNames: { '#status': 'status' },
 * //   ExpressionAttributeValues: { ':status': 'ACTIVE' },
 * //   Limit: 25,
 * //   ConsistentRead: false,
 * //   ReturnConsumedCapacity: 'NONE'
 * // }
 * ```
 *
 * @param input The custom scan request.
 * @returns A validated DocumentClient `ScanCommandInput`.
 * @throws On schema or expression-token validation errors.
 */
export function buildValidatedScanCommand(input: CustomScanCmdInput): ScanCommandInput {
  try {
    const parsed = customScanCmdInputSch.parse(input);

    const commandInput: ScanCommandInput = {
      TableName: parsed.tableName,
      ConsistentRead: parsed.consistentRead,
      ReturnConsumedCapacity: parsed.returnConsumedCapacity,
      ...(parsed.indexName && { IndexName: parsed.indexName }),
      ...(parsed.limit !== undefined && { Limit: parsed.limit }),
      ...(parsed.exclusiveStartKey && { ExclusiveStartKey: parsed.exclusiveStartKey }),
      ...(parsed.select && { Select: parsed.select }),
      ...(parsed.segment !== undefined && { Segment: parsed.segment }),
      ...(parsed.totalSegments !== undefined && { TotalSegments: parsed.totalSegments }),
      ...(parsed.filterExpression && { FilterExpression: parsed.filterExpression }),
      ...(parsed.projectionExpression && { ProjectionExpression: parsed.projectionExpression }),
    };

    // Filter and projection expressions share the same token mappings.
    const expressions = [parsed.filterExpression, parsed.projectionExpression].filter(
      (expression): expression is string => Boolean(expression)
    );
    if (expressions.length === 0) return commandInput;

    // Extract referenced attribute names and values from the expressions.
    const { names: referencedNames, values: referencedValues } = extractExpressionTokens(expressions);
    // Infer shorthand attribute-name mappings from both expressions.
    const generatedNames: Record<string, string> = {};

    for (const expression of expressions) {
      Object.assign(generatedNames, extractExpAttributeNamesFromExpression(expression));
    }

    // Explicit caller mappings always override inferred mappings.
    const mergedNames: Record<string, string> = {
      ...generatedNames,
      ...parsed.expressionAttributeNames,
    };

    const providedValues = parsed.expressionAttributeValues ?? {};

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    // Retain only referenced name mappings.
    for (const token of referencedNames) {
      const name = mergedNames[token];

      if (name === undefined) {
        throw new Error(`Missing expression attribute name: "${token}".`);
      }

      names[token] = name;
    }

    // Retain only referenced values.
    for (const token of referencedValues) {
      const value = providedValues[token];

      if (value === undefined) {
        throw new Error(`Missing expression attribute value: "${token}".`);
      }

      values[token] = value;
    }

    // Attach the filtered attribute names and values to the command input if they exist.
    if (Object.keys(names).length > 0) commandInput.ExpressionAttributeNames = names;
    if (Object.keys(values).length > 0) commandInput.ExpressionAttributeValues = values;

    return commandInput;
  } catch (error: unknown) {
    console.error('Failed to build validated ScanCommand:', error);

    throw error;
  }
}
