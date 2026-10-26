import {
  customQueryCmdInputSch,
  decodeDynamoValue,
  dynamoReadQueryRequestSch,
  type CustomQueryCmdInput,
  type DynamoAttrType,
  type DynamoFilterOperator,
  type DynamoSortKeyOperator,
  type QueryKeyValue,
  type QuerySortCondition,
} from '@/types';

type TokenState = {
  names: Record<string, string>;
  values: Record<string, unknown>;
  occupiedNames: Set<string>;
  occupiedValues: Set<string>;
};

/** Minimal query-string shape shared by API Gateway REST API and HTTP API events. */
export type ApiGatewayQueryEvent = {
  queryStringParameters?: Readonly<Record<string, string | undefined>> | null;
};

/**
 * Extracts API Gateway query-string parameters and converts them into the
 * schema-free input used by {@link buildValidatedQueryCommand}.
 *
 * When the event has no query-string parameters, the developer-provided
 * default input is validated with `customQueryCmdInputSch` and returned.
 * An empty parameter object and an object containing only `undefined` values
 * are both treated as missing query parameters.
 *
 * ### Notes:
 * - Supports the common `queryStringParameters` property used by API Gateway
 *   REST API payload v1 and HTTP API payload v2 events.
 * - The fallback applies only when parameters are absent, not when provided
 *   parameters are invalid.
 * - This function does not execute a query or inspect whether DynamoDB returned items.
 *
 * Convert event parameters
 *
 * ```ts
 * const input = getCustomQueryInputFromApiGatewayEvent(
 *   {
 *     queryStringParameters: {
 *       operation: 'QUERY',
 *       table: 'Orders',
 *       pkAttr1Name: 'customerId',
 *       pkAttr1Value: 'customer-1',
 *       limit: '25'
 *     }
 *   },
 *   {
 *     tableName: 'Orders',
 *     partitionKeys: { customerId: 'default-customer' }
 *   }
 * )
 *
 * // input:
 * // {
 * //   tableName: 'Orders',
 * //   partitionKeys: { customerId: 'customer-1' },
 * //   sortKeys: {},
 * //   limit: 25,
 * //   consistentRead: false,
 * //   scanIndexForward: true,
 * //   returnConsumedCapacity: 'NONE'
 * // }
 * ```
 *
 * Use the default when parameters are missing
 *
 * ```ts
 * const input = getCustomQueryInputFromApiGatewayEvent(
 *   { queryStringParameters: null },
 *   { tableName: 'Orders', partitionKeys: { status: 'ACTIVE' } }
 * )
 *
 * // input.partitionKeys: { status: 'ACTIVE' }
 * ```
 *
 * @param event An API Gateway-compatible event containing optional query parameters.
 * @param defaultInput Query input returned when the event has no query parameters.
 * @returns Validated `customQueryCmdInputSch` input.
 * @throws If provided event parameters or the selected default input are invalid.
 */
export function getCustomQueryInputFromApiGatewayEvent(
  event: ApiGatewayQueryEvent,
  defaultInput: CustomQueryCmdInput
): CustomQueryCmdInput {
  const queryStringParameters = event.queryStringParameters;
  const hasQueryStringParameters =
    queryStringParameters !== null &&
    queryStringParameters !== undefined &&
    Object.values(queryStringParameters).some((value) => value !== undefined);

  if (!hasQueryStringParameters) {
    return customQueryCmdInputSch.parse(defaultInput);
  }

  return convertDynamoReadQueryRequestToCustomQueryInput(queryStringParameters);
}

/**
 * Converts an API-facing DynamoDB query request into the schema-free input used
 * by {@link buildValidatedQueryCommand}.
 *
 * ### Process Flow:
 * 1. Parse and normalize raw HTTP query parameters.
 * 2. Reject SCAN requests because the target shape is query-specific.
 * 3. Decode typed partition-key and sort-key strings into native values.
 * 4. Convert sort operators into the keyed sort-condition DSL.
 * 5. Generate a filter expression and collision-safe expression mappings.
 * 6. Copy projection, pagination, ordering, consistency, and capacity options.
 * 7. Validate and return the resulting custom query-command input.
 *
 * ### Notes:
 * - API-only fields such as `region`, `tab`, and `maximize` are intentionally omitted.
 * - Equality sort conditions become direct values; they do not use an `eq` wrapper.
 * - The returned values are native DocumentClient values rather than encoded strings.
 * - This function converts input only and does not build or execute an AWS command.
 *
 * @example Convert raw HTTP query parameters
 * ```ts
 * const input = convertDynamoReadQueryRequestToCustomQueryInput({
 *   operation: 'QUERY',
 *   table: 'Orders',
 *   index: 'byTenantAndDate',
 *   pkAttr1Name: 'tenantId',
 *   pkAttr1Value: 'tenant-1',
 *   skAttr1Name: 'createdAt',
 *   skAttr1Condition: 'BETWEEN',
 *   skAttr1Value: '100',
 *   skAttr1Value2: '200',
 *   skAttr1ValueType: 'N',
 *   filterAttr1Name: 'status',
 *   filterAttr1Condition: 'EQUAL_TO',
 *   filterAttr1Value: 'ACTIVE'
 * })
 *
 * // input:
 * // {
 * //   tableName: 'Orders',
 * //   indexName: 'byTenantAndDate',
 * //   partitionKeys: { tenantId: 'tenant-1' },
 * //   sortKeys: { createdAt: { between: [100, 200] } },
 * //   filterExpression: '#filter0 = :filter0',
 * //   expressionAttributeNames: { '#filter0': 'status' },
 * //   expressionAttributeValues: { ':filter0': 'ACTIVE' },
 * //   consistentRead: false,
 * //   scanIndexForward: true,
 * //   returnConsumedCapacity: 'NONE'
 * // }
 * ```
 *
 * @param input Raw or previously parsed `dynamoReadQueryRequestSch` input.
 * @returns Validated input for `buildValidatedQueryCommand`.
 * @throws If the request is invalid, represents a SCAN, repeats a key name, or contains an invalid typed value.
 */
export function convertDynamoReadQueryRequestToCustomQueryInput(input: unknown): CustomQueryCmdInput {
  try {
    const parsed = dynamoReadQueryRequestSch.parse(input);

    if (parsed.operation !== 'QUERY') {
      throw new Error('Only QUERY requests can be converted to custom query-command input.');
    }

    const request = parsed as unknown as Record<string, unknown>;
    const partitionKeys: Record<string, QueryKeyValue> = {};
    const sortKeys: Record<string, QuerySortCondition> = {};
    const keyNames = new Set<string>();

    for (let position = 1; position <= 4; position++) {
      const name = request[`pkAttr${position}Name`] as string | undefined;
      const value = request[`pkAttr${position}Value`] as string | undefined;
      if (name === undefined || value === undefined) continue;

      assertUniqueKeyName(keyNames, name);
      partitionKeys[name] = decodeDynamoValue(
        value,
        (request[`pkAttr${position}ValueType`] as DynamoAttrType | undefined) ?? 'S'
      ) as QueryKeyValue;
    }

    for (let position = 1; position <= 4; position++) {
      const name = request[`skAttr${position}Name`] as string | undefined;
      const value = request[`skAttr${position}Value`] as string | undefined;
      if (name === undefined || value === undefined) continue;

      assertUniqueKeyName(keyNames, name);
      const valueType = (request[`skAttr${position}ValueType`] as DynamoAttrType | undefined) ?? 'S';
      const decodedValue = decodeDynamoValue(value, valueType) as QueryKeyValue;
      const secondValue = request[`skAttr${position}Value2`] as string | undefined;

      sortKeys[name] = toSortCondition(
        (request[`skAttr${position}Condition`] as DynamoSortKeyOperator | undefined) ?? 'EQUAL_TO',
        decodedValue,
        secondValue === undefined ? undefined : (decodeDynamoValue(secondValue, valueType) as QueryKeyValue)
      );
    }

    const tokenState: TokenState = {
      names: { ...parsed.expressionAttributeNames },
      values: {},
      occupiedNames: new Set(Object.keys(parsed.expressionAttributeNames ?? {})),
      occupiedValues: new Set(),
    };
    const filters: string[] = [];

    for (let position = 1; position <= 5; position++) {
      const name = request[`filterAttr${position}Name`] as string | undefined;
      const operator = request[`filterAttr${position}Condition`] as DynamoFilterOperator | undefined;
      if (name === undefined || operator === undefined) continue;

      const nameToken = addNameToken(tokenState, `filter${position - 1}`, name);

      if (operator === 'EXISTS' || operator === 'NOT_EXISTS') {
        filters.push(toFilterExpression(nameToken, operator));
        continue;
      }

      const valueType = (request[`filterAttr${position}ValueType`] as DynamoAttrType | undefined) ?? 'S';
      const rawValue = request[`filterAttr${position}Value`];
      const valueToken = addValueToken(
        tokenState,
        `filter${position - 1}`,
        decodeDynamoValue(typeof rawValue === 'string' ? rawValue : undefined, valueType)
      );
      const rawSecondValue = request[`filterAttr${position}Value2`] as string | undefined;
      const secondValueToken =
        rawSecondValue === undefined
          ? undefined
          : addValueToken(tokenState, `filter${position - 1}End`, decodeDynamoValue(rawSecondValue, valueType));

      filters.push(toFilterExpression(nameToken, operator, valueToken, secondValueToken));
    }

    return customQueryCmdInputSch.parse({
      tableName: parsed.table,
      partitionKeys,
      sortKeys,
      scanIndexForward: parsed.sorting !== 'DESC',
      ...(parsed.index && { indexName: parsed.index }),
      ...(filters.length > 0 && { filterExpression: filters.join(` ${parsed.filterJoin} `) }),
      ...(parsed.projectionExpression && { projectionExpression: parsed.projectionExpression }),
      ...(Object.keys(tokenState.names).length > 0 && { expressionAttributeNames: tokenState.names }),
      ...(Object.keys(tokenState.values).length > 0 && { expressionAttributeValues: tokenState.values }),
      ...(parsed.lastEvaluatedKey && { exclusiveStartKey: parsed.lastEvaluatedKey }),
      ...(parsed.limit !== undefined && { limit: parsed.limit }),
      ...(parsed.consistentRead !== undefined && { consistentRead: parsed.consistentRead }),
      ...(parsed.select && { select: parsed.select }),
      ...(parsed.returnConsumedCapacity && { returnConsumedCapacity: parsed.returnConsumedCapacity }),
    });
  } catch (error: unknown) {
    console.error('Failed to convert Dynamo read query request:', error);
    throw error;
  }
}

/** Short alias for {@link convertDynamoReadQueryRequestToCustomQueryInput}. */
export const convertDynamoReadQueryRequest = convertDynamoReadQueryRequestToCustomQueryInput;

function toSortCondition(
  operator: DynamoSortKeyOperator,
  value: QueryKeyValue,
  secondValue?: QueryKeyValue
): QuerySortCondition {
  switch (operator) {
    case 'EQUAL_TO':
      return value;
    case 'LESS_THAN':
      return { lt: value };
    case 'LESS_THAN_OR_EQUAL_TO':
      return { lte: value };
    case 'GREATER_THAN':
      return { gt: value };
    case 'GREATER_THAN_OR_EQUAL_TO':
      return { gte: value };
    case 'BEGINS_WITH':
      if (typeof value !== 'string' && !(value instanceof Uint8Array)) {
        throw new Error('BEGINS_WITH requires a string or binary value.');
      }
      return { beginsWith: value };
    case 'BETWEEN':
      return { between: [value, secondValue!] };
  }
}

function toFilterExpression(
  nameToken: string,
  operator: DynamoFilterOperator,
  valueToken?: string,
  secondValueToken?: string
): string {
  switch (operator) {
    case 'EQUAL_TO':
      return `${nameToken} = ${valueToken}`;
    case 'NOT_EQUAL_TO':
      return `${nameToken} <> ${valueToken}`;
    case 'LESS_THAN':
      return `${nameToken} < ${valueToken}`;
    case 'LESS_THAN_OR_EQUAL_TO':
      return `${nameToken} <= ${valueToken}`;
    case 'GREATER_THAN':
      return `${nameToken} > ${valueToken}`;
    case 'GREATER_THAN_OR_EQUAL_TO':
      return `${nameToken} >= ${valueToken}`;
    case 'BETWEEN':
      return `${nameToken} BETWEEN ${valueToken} AND ${secondValueToken}`;
    case 'BEGINS_WITH':
      return `begins_with(${nameToken}, ${valueToken})`;
    case 'CONTAINS':
      return `contains(${nameToken}, ${valueToken})`;
    case 'NOT_CONTAINS':
      return `NOT contains(${nameToken}, ${valueToken})`;
    case 'EXISTS':
      return `attribute_exists(${nameToken})`;
    case 'NOT_EXISTS':
      return `attribute_not_exists(${nameToken})`;
  }
}

function assertUniqueKeyName(keyNames: Set<string>, name: string): void {
  if (keyNames.has(name)) throw new Error(`Duplicate query key attribute: "${name}".`);
  keyNames.add(name);
}

function addNameToken(state: TokenState, base: string, attributeName: string): string {
  const token = allocateToken(state.occupiedNames, `#${base}`);
  state.names[token] = attributeName;
  return token;
}

function addValueToken(state: TokenState, base: string, value: unknown): string {
  const token = allocateToken(state.occupiedValues, `:${base}`);
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
