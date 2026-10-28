import { CustomScanCmdInput, customScanCmdInputSch } from '@/types';
import { extractExpAttributeNamesFromExpression } from '@/utils';
import { compileStructuredCondition } from '@/utils/condition-expression';
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
 * 4. Compile structured filters into a filter expression and token maps.
 * 5. Compile structured projection paths into collision-safe aliases.
 * 6. Merge any advanced raw-expression mappings.
 * 7. Remove unused raw expression mappings and reject missing ones.
 * 8. Return the validated `ScanCommandInput`.
 *
 * ### Notes:
 * - Uses `@aws-sdk/lib-dynamodb` with native JavaScript values.
 * - Structured `filter`/`filters` and `attributes` avoid handwritten expressions.
 * - Raw expressions remain available as an advanced compatibility escape hatch.
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
 *   filters: { status: 'ACTIVE', total: { gte: 1000 } },
 *   attributes: ['orderId', 'status', 'total'],
 *   limit: 25
 * })
 *
 * // input:
 * // {
 * //   TableName: 'Orders',
 * //   IndexName: 'byStatus',
 * //   FilterExpression: '#conditionName0 = :conditionValue0 AND #conditionName1 >= :conditionValue1',
 * //   ProjectionExpression: '#scanAttr0, #scanAttr1, #scanAttr2',
 * //   ExpressionAttributeNames: {
 * //     '#conditionName0': 'status', '#conditionName1': 'total',
 * //     '#scanAttr0': 'orderId', '#scanAttr1': 'status', '#scanAttr2': 'total'
 * //   },
 * //   ExpressionAttributeValues: { ':conditionValue0': 'ACTIVE', ':conditionValue1': 1000 },
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

    const rawExpressions = [parsed.filterExpression, parsed.projectionExpression].filter(
      (expression): expression is string => expression !== undefined
    );
    const { names: referencedNames, values: referencedValues } = extractExpressionTokens(rawExpressions);
    const occupiedNameTokens = new Set([...referencedNames, ...Object.keys(parsed.expressionAttributeNames ?? {})]);
    const occupiedValueTokens = new Set([...referencedValues, ...Object.keys(parsed.expressionAttributeValues ?? {})]);
    const structuredFilter = compileStructuredCondition(
      {
        condition: parsed.filter,
        conditions: parsed.filters,
        conditionJoin: parsed.filterJoin ?? 'AND',
      },
      { occupiedNameTokens, occupiedValueTokens }
    );

    const names: Record<string, string> = { ...structuredFilter?.expressionAttributeNames };
    const values: Record<string, unknown> = { ...structuredFilter?.expressionAttributeValues };
    const inferredNames = Object.assign({}, ...rawExpressions.map(extractExpAttributeNamesFromExpression));

    for (const token of referencedNames) {
      const name = parsed.expressionAttributeNames?.[token] ?? inferredNames[token];
      if (name === undefined) throw new Error(`Missing expression attribute name: "${token}".`);
      names[token] = name;
    }
    for (const token of referencedValues) {
      const value = parsed.expressionAttributeValues?.[token];
      if (value === undefined) throw new Error(`Missing expression attribute value: "${token}".`);
      values[token] = value;
    }

    const projectionParts = parsed.projectionExpression ? [parsed.projectionExpression] : [];
    const projectionTokensByName = new Map<string, string>();
    let nextProjectionToken = 0;
    const allocateProjectionName = (attributeName: string) => {
      const reused = projectionTokensByName.get(attributeName);
      if (reused) return reused;
      let token = `#scanAttr${nextProjectionToken++}`;
      while (occupiedNameTokens.has(token) || token in names) token = `#scanAttr${nextProjectionToken++}`;
      occupiedNameTokens.add(token);
      projectionTokensByName.set(attributeName, token);
      names[token] = attributeName;
      return token;
    };

    for (const attributePath of new Set(parsed.attributes ?? [])) {
      const parts = attributePath.match(/[^.[\]]+|\[\d+\]/g) ?? [];
      projectionParts.push(
        parts
          .map((part) => (part.startsWith('[') ? part : allocateProjectionName(part)))
          .reduce((path, part, index) => `${path}${index > 0 && !part.startsWith('[') ? '.' : ''}${part}`, '')
      );
    }

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
      ...((structuredFilter?.expression ?? parsed.filterExpression) && {
        FilterExpression: structuredFilter?.expression ?? parsed.filterExpression,
      }),
      ...(projectionParts.length > 0 && { ProjectionExpression: projectionParts.join(', ') }),
    };
    if (Object.keys(names).length > 0) commandInput.ExpressionAttributeNames = names;
    if (Object.keys(values).length > 0) commandInput.ExpressionAttributeValues = values;

    return commandInput;
  } catch (error: unknown) {
    console.error('Failed to build validated ScanCommand:', error);

    throw error;
  }
}
