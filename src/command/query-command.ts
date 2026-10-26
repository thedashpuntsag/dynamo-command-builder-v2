import { CustomQueryCmdInput, customQueryCmdInputSch, QueryKeyValue, QuerySortCondition } from '@/types';
import { extractExpAttributeNamesFromExpression } from '@/utils';
import type { QueryCommandInput } from '@aws-sdk/lib-dynamodb';

type ExpressionState = {
  names: Record<string, string>;
  values: Record<string, unknown>;
  occupiedNameTokens: Set<string>;
  occupiedValueTokens: Set<string>;
};

/**
 * Validates input and builds an AWS SDK DocumentClient `QueryCommandInput`.
 *
 * ### Process Flow:
 * 1. Validate the input against the query-command schema.
 * 2. Generate equality conditions for one to four named partition keys.
 * 3. Generate ordered conditions for up to four named sort keys.
 * 4. Generate collision-safe expression name and value tokens.
 * 5. Merge tokens referenced by filter and projection expressions.
 * 6. Attach index, pagination, consistency, ordering, and response options.
 * 7. Return the validated `QueryCommandInput`.
 *
 * ### Notes:
 * - No table, index, or entity definition is required.
 * - Partition and sort keys are supplied as attribute-name keyed objects.
 * - Native JavaScript values are passed directly to `@aws-sdk/lib-dynamodb`.
 * - Plain sort-key values and `{ eq: value }` generate equality conditions.
 * - A range condition must be the final sort-key entry.
 * - Caller-provided expression mappings are retained only when referenced.
 * - The builder does not execute AWS operations.
 * - DynamoDB remains responsible for validating keys against the target table or index.
 *
 * @example Query an index with named composite keys
 * ```ts
 * const input = buildValidatedQueryCommand({
 *   tableName: 'Orders',
 *   indexName: 'byTenantAndDate',
 *   partitionKeys: { tenantId: 'tenant-1', region: 'MN' },
 *   sortKeys: { year: 2026, createdAt: { between: [100, 200] } }
 * })
 *
 * // input:
 * // {
 * //   TableName: 'Orders',
 * //   IndexName: 'byTenantAndDate',
 * //   KeyConditionExpression:
 * //     '#pk0 = :pk0 AND #pk1 = :pk1 AND #sk0 = :sk0 AND #sk1 BETWEEN :sk1Start AND :sk1End',
 * //   ExpressionAttributeNames: {
 * //     '#pk0': 'tenantId', '#pk1': 'region', '#sk0': 'year', '#sk1': 'createdAt'
 * //   },
 * //   ExpressionAttributeValues: {
 * //     ':pk0': 'tenant-1', ':pk1': 'MN', ':sk0': 2026, ':sk1Start': 100, ':sk1End': 200
 * //   },
 * //   ConsistentRead: false,
 * //   ScanIndexForward: true,
 * //   ReturnConsumedCapacity: 'NONE'
 * // }
 * ```
 *
 * @param input The schema-free query request to validate and build.
 * @returns A validated DocumentClient `QueryCommandInput`.
 * @throws On schema validation, invalid key ordering, or missing expression mappings.
 */
export function buildValidatedQueryCommand(input: CustomQueryCmdInput): QueryCommandInput {
  try {
    const parsed = customQueryCmdInputSch.parse(input);

    const state: ExpressionState = {
      names: {},
      values: {},
      occupiedNameTokens: new Set(Object.keys(parsed.expressionAttributeNames ?? {})),
      occupiedValueTokens: new Set(Object.keys(parsed.expressionAttributeValues ?? {})),
    };

    const keyConditions: string[] = [];

    Object.entries(parsed.partitionKeys).forEach(([attributeName, value], index) => {
      const nameToken = addName(state, `pk${index}`, attributeName);
      const valueToken = addValue(state, `pk${index}`, value);

      keyConditions.push(`${nameToken} = ${valueToken}`);
    });

    Object.entries(parsed.sortKeys).forEach(([attributeName, condition], index) => {
      const nameToken = addName(state, `sk${index}`, attributeName);

      keyConditions.push(buildSortCondition(state, nameToken, `sk${index}`, condition));
    });

    const expressions = [parsed.filterExpression, parsed.projectionExpression].filter(
      (expression): expression is string => expression !== undefined
    );
    const referencedNameTokens = new Set(
      expressions.flatMap((expression) => expression.match(/#[A-Za-z0-9_]+/g) ?? [])
    );
    const referencedValueTokens = new Set(
      expressions.flatMap((expression) => expression.match(/:[A-Za-z0-9_]+/g) ?? [])
    );
    const inferredNames = Object.assign({}, ...expressions.map(extractExpAttributeNamesFromExpression));

    for (const token of referencedNameTokens) {
      const attributeName = parsed.expressionAttributeNames?.[token] ?? inferredNames[token];

      if (attributeName === undefined) {
        throw new Error(`Missing expression attribute name: "${token}".`);
      }

      state.names[token] = attributeName;
    }

    for (const token of referencedValueTokens) {
      if (!Object.hasOwn(parsed.expressionAttributeValues ?? {}, token)) {
        throw new Error(`Missing expression attribute value: "${token}".`);
      }

      state.values[token] = parsed.expressionAttributeValues?.[token];
    }

    const commandInput: QueryCommandInput = {
      TableName: parsed.tableName,
      KeyConditionExpression: keyConditions.join(' AND '),
      ConsistentRead: parsed.consistentRead,
      ScanIndexForward: parsed.scanIndexForward,
      ReturnConsumedCapacity: parsed.returnConsumedCapacity,
      ...(parsed.indexName && { IndexName: parsed.indexName }),
      ...(parsed.filterExpression && { FilterExpression: parsed.filterExpression }),
      ...(parsed.projectionExpression && { ProjectionExpression: parsed.projectionExpression }),
      ...(parsed.exclusiveStartKey && { ExclusiveStartKey: parsed.exclusiveStartKey }),
      ...(parsed.limit !== undefined && { Limit: parsed.limit }),
      ...(parsed.select && { Select: parsed.select }),
    };

    if (Object.keys(state.names).length > 0) commandInput.ExpressionAttributeNames = state.names;
    if (Object.keys(state.values).length > 0) commandInput.ExpressionAttributeValues = state.values;

    return commandInput;
  } catch (error: unknown) {
    console.error('Failed to build validated QueryCommand:', error);

    throw error;
  }
}

/** Alias matching the AWS SDK command-input terminology. */
export const buildQueryCommandInput = buildValidatedQueryCommand;

function buildSortCondition(
  state: ExpressionState,
  nameToken: string,
  tokenBase: string,
  condition: QuerySortCondition
): string {
  if (isQueryKeyValue(condition)) {
    return `${nameToken} = ${addValue(state, tokenBase, condition)}`;
  }

  if ('eq' in condition) return `${nameToken} = ${addValue(state, tokenBase, condition.eq)}`;
  if ('lt' in condition) return `${nameToken} < ${addValue(state, tokenBase, condition.lt)}`;
  if ('lte' in condition) return `${nameToken} <= ${addValue(state, tokenBase, condition.lte)}`;
  if ('gt' in condition) return `${nameToken} > ${addValue(state, tokenBase, condition.gt)}`;
  if ('gte' in condition) return `${nameToken} >= ${addValue(state, tokenBase, condition.gte)}`;
  if ('beginsWith' in condition) {
    return `begins_with(${nameToken}, ${addValue(state, tokenBase, condition.beginsWith)})`;
  }

  const lowerToken = addValue(state, `${tokenBase}Start`, condition.between[0]);
  const upperToken = addValue(state, `${tokenBase}End`, condition.between[1]);

  return `${nameToken} BETWEEN ${lowerToken} AND ${upperToken}`;
}

function isQueryKeyValue(value: QuerySortCondition): value is QueryKeyValue {
  return (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || value instanceof Uint8Array
  );
}

function addName(state: ExpressionState, base: string, attributeName: string): string {
  const token = allocateToken(state.occupiedNameTokens, `#${base}`);
  state.names[token] = attributeName;
  return token;
}

function addValue(state: ExpressionState, base: string, value: QueryKeyValue): string {
  const token = allocateToken(state.occupiedValueTokens, `:${base}`);
  state.values[token] = value;
  return token;
}

function allocateToken(occupiedTokens: Set<string>, preferredToken: string): string {
  let token = preferredToken;
  let suffix = 1;

  while (occupiedTokens.has(token)) token = `${preferredToken}_${suffix++}`;

  occupiedTokens.add(token);
  return token;
}
