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
 * ### Process Flow:
 * 1. Check whether any query-string parameter has a defined value.
 * 2. Validate and return the default input when no defined parameter is present.
 * 3. Otherwise convert and validate the supplied query parameters.
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
 * @example Convert event parameters
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
 * @example Use the default when parameters are missing
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
      filterJoin: parsed.filterJoin,
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

/**
 * Provides a short alias for convertDynamoReadQueryRequestToCustomQueryInput.
 *
 * ### Process Flow:
 * 1. Forward the input to the same query-request converter.
 * 2. Return its validated command input without changing behavior.
 *
 * @param input - Raw or previously parsed DynamoDB read-query request.
 * @returns Validated custom query-command input.
 * @throws If request parsing, typed-value decoding, or query validation fails.
 *
 * @example
 * ```ts
 * const input = convertDynamoReadQueryRequest({
 *   operation: 'QUERY', table: 'Orders',
 *   pkAttr1Name: 'customerId', pkAttr1Value: 'customer-1',
 * });
 * // input.partitionKeys: { customerId: 'customer-1' }
 * ```
 */
export const convertDynamoReadQueryRequest = convertDynamoReadQueryRequestToCustomQueryInput;

/**
 * Converts a parsed API sort comparator and native values into a query sort condition.
 *
 * ### Process Flow:
 * 1. Return the value directly for equality.
 * 2. Wrap ordered and prefix comparisons in the matching operator object.
 * 3. Use both decoded bounds for BETWEEN.
 *
 * @param operator - Sort comparator from a validated request.
 * @param value - Decoded comparison value or lower bound.
 * @param secondValue - Decoded upper bound; required by the validated BETWEEN request.
 * @returns A direct equality value or structured sort condition.
 * @throws If BEGINS_WITH receives a value that is neither a string nor binary.
 *
 * @example
 * ```ts
 * toSortCondition('GREATER_THAN_OR_EQUAL_TO', 100); // { gte: 100 }
 * ```
 */
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

/**
 * Formats a validated API filter operator using already allocated expression tokens.
 *
 * ### Process Flow:
 * 1. Select the comparator or function for the supplied operator.
 * 2. Insert name and value tokens, including a second bound for BETWEEN.
 * 3. Return the expression fragment without allocating mappings.
 *
 * @param nameToken - Allocated attribute-name token.
 * @param operator - Filter comparator or existence function.
 * @param valueToken - Allocated value token; omitted for existence checks.
 * @param secondValueToken - Allocated upper-bound token for BETWEEN.
 * @returns A filter-expression fragment.
 *
 * @example
 * ```ts
 * toFilterExpression('#status', 'EQUAL_TO', ':expected'); // '#status = :expected'
 * ```
 */
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

/**
 * Rejects repeated key names across the query’s partition and sort key slots.
 *
 * ### Process Flow:
 * 1. Check the set of names already seen.
 * 2. Throw for a duplicate; otherwise add the name to the set.
 *
 * @param keyNames - Mutable set shared across partition and sort key processing.
 * @param name - Key attribute name to register.
 * @returns Nothing; updates keyNames in place.
 * @throws If the name has already been registered.
 */
function assertUniqueKeyName(keyNames: Set<string>, name: string): void {
  if (keyNames.has(name)) throw new Error(`Duplicate query key attribute: "${name}".`);
  keyNames.add(name);
}

/**
 * Allocates and stores a collision-safe attribute-name placeholder.
 *
 * ### Process Flow:
 * 1. Prefix the base with # and reserve an available token.
 * 2. Store the supplied attribute name in the state mapping.
 * 3. Return the allocated token.
 *
 * @param state - Mutable token mappings and occupied-token sets.
 * @param base - Token base without its prefix.
 * @param attributeName - Attribute name to alias.
 * @returns The allocated token; state mappings and occupancy are updated in place.
 */
function addNameToken(state: TokenState, base: string, attributeName: string): string {
  const token = allocateToken(state.occupiedNames, `#${base}`);
  state.names[token] = attributeName;
  return token;
}

/**
 * Allocates and stores a collision-safe attribute-value placeholder.
 *
 * ### Process Flow:
 * 1. Prefix the base with : and reserve an available token.
 * 2. Store the supplied native value in the state mapping.
 * 3. Return the allocated token.
 *
 * @param state - Mutable token mappings and occupied-token sets.
 * @param base - Token base without its prefix.
 * @param value - Native value to associate with the placeholder.
 * @returns The allocated token; state mappings and occupancy are updated in place.
 */
function addValueToken(state: TokenState, base: string, value: unknown): string {
  const token = allocateToken(state.occupiedValues, `:${base}`);
  state.values[token] = value;
  return token;
}

/**
 * Reserves a preferred expression token or a deterministic suffixed alternative.
 *
 * ### Process Flow:
 * 1. Start with the preferred token.
 * 2. Try numeric suffixes until the token is unoccupied.
 * 3. Reserve the chosen token and return it.
 *
 * @param occupiedTokens - Mutable set of unavailable tokens.
 * @param preferredToken - Desired token, including its hash or colon prefix.
 * @returns A token added to occupiedTokens.
 *
 * @example
 * ```ts
 * const occupied = new Set(['#filter0']);
 * allocateToken(occupied, '#filter0'); // '#filter0_1'
 * ```
 */
function allocateToken(occupiedTokens: Set<string>, preferredToken: string): string {
  let token = preferredToken;
  let suffix = 1;

  while (occupiedTokens.has(token)) token = `${preferredToken}_${suffix++}`;

  occupiedTokens.add(token);
  return token;
}
