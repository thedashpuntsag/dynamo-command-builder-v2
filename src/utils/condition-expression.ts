import { conditionRecordSch, conditionSch } from '../types/condition.types';
import type { Condition, ConditionComparison, ConditionOperation, ConditionRecord } from '../types/condition.types';

/**
 * Validates record shorthand and converts each attribute check into a condition leaf.
 *
 * ### Process Flow:
 * 1. Validate the nonempty record and each operator or literal value.
 * 2. Translate direct values into equality leaves and operator objects into attribute-based leaves.
 * 3. Return one leaf directly, or group multiple leaves with the selected join.
 *
 * @param input - Nonempty attribute-path record using literal equality values or operator objects.
 * @param join - Logical join for multiple entries; defaults to AND.
 * @returns A condition leaf or an AND/OR group suitable for compilation.
 * @throws If paths, operators, or supplied DynamoDB values fail validation.
 *
 * @example
 * ```ts
 * normalizeConditions({ version: 3, deletedAt: { notExists: true } });
 * // { and: [{ attr: 'version', eq: 3 }, { attr: 'deletedAt', notExists: true }] }
 * ```
 */
export function normalizeConditions(input: ConditionRecord, join: 'AND' | 'OR' = 'AND'): Condition {
  const nodes = Object.entries(conditionRecordSch.parse(input)).map(([attr, value]): Condition => {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value instanceof Set ||
      value instanceof Uint8Array
    ) {
      return { attr, eq: value };
    }
    // The schema has already validated that object values contain exactly one operator.
    const operation = value as ConditionOperation;
    return { attr, ...operation };
  });
  return nodes.length === 1 ? nodes[0]! : join === 'AND' ? { and: nodes } : { or: nodes };
}

/** Existing placeholders that a compiler must reserve before generating its own tokens. */
export type ConditionTokenScope = {
  occupiedNameTokens?: Iterable<string>;
  occupiedValueTokens?: Iterable<string>;
};

/**
 * Selects a structured condition from command input and compiles its expression mappings.
 *
 * ### Process Flow:
 * 1. Prefer the condition field, or normalize conditions with its optional conditionJoin.
 * 2. Return undefined when neither structured mode is supplied.
 * 3. Compile the selected condition while reserving the provided token scope.
 *
 * @param input - Command condition fields; callers validate mutually exclusive modes before calling.
 * @param scope - Optional occupied name and value tokens, typically from an update expression.
 * @returns Compiled expression, mappings, and operator count, or undefined for an absent structured condition.
 * @throws If the structured condition is invalid or compilation exceeds a local expression limit.
 *
 * @example
 * ```ts
 * const compiled = compileStructuredCondition({ condition: { attr: 'id', notExists: true } });
 * // compiled?.expression: 'attribute_not_exists(#conditionName0)'
 * ```
 */
export function compileStructuredCondition(
  input: {
    condition?: Condition | undefined;
    conditions?: ConditionRecord | undefined;
    conditionJoin?: 'AND' | 'OR' | undefined;
  },
  scope: ConditionTokenScope = {}
) {
  const condition =
    input.condition ??
    (input.conditions !== undefined ? normalizeConditions(input.conditions, input.conditionJoin) : undefined);
  return condition === undefined ? undefined : compileConditionExpression(condition, scope);
}

/**
 * Compiles a structured condition into deterministic DynamoDB expression text and native-value mappings.
 *
 * ### Process Flow:
 * 1. Validate condition nodes, paths, literal values, and logical groups.
 * 2. Reserve caller tokens and generate reusable aliases for path segments.
 * 3. Recursively render comparisons, functions, and explicitly grouped logical expressions.
 * 4. Enforce the 300-operator/function budget and 4 KB UTF-8 expression limit.
 * 5. Return the expression, referenced mappings, and operator count.
 *
 * @param input - Attribute condition leaf or nested AND/OR/NOT tree.
 * @param scope - Optional occupied name and value tokens to avoid overwriting caller placeholders.
 * @returns Expression text, ExpressionAttributeNames/Values mappings, and the counted operators/functions.
 * @throws If schema validation fails, more than 300 operators/functions are counted, or the expression exceeds 4 KB.
 *
 * @example
 * ```ts
 * const result = compileConditionExpression({ attr: 'version', eq: 3 });
 * // result.expression: '#conditionName0 = :conditionValue0'
 * // result.expressionAttributeNames: { '#conditionName0': 'version' }
 * // result.expressionAttributeValues: { ':conditionValue0': 3 }
 * ```
 */
export function compileConditionExpression(input: Condition, scope: ConditionTokenScope = {}) {
  const condition = conditionSch.parse(input);
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const aliases = new Map<string, string>();
  const occupiedNames = new Set(scope.occupiedNameTokens);
  const occupiedValues = new Set(scope.occupiedValueTokens);
  /**
   * Reserves an expression token while avoiding the compiler’s shared occupied-token set.
   *
   * ### Process Flow:
   * 1. Try the base token and then deterministic numeric suffixes.
   * 2. Add the available token to the supplied occupied set.
   * 3. Return the reserved token.
   *
   * @param occupied - Mutable set of reserved name or value tokens.
   * @param base - Preferred token, including its prefix.
   * @returns The collision-safe token.
   */
  const allocate = (occupied: Set<string>, base: string) => {
    let token = base;
    let suffix = 1;
    while (occupied.has(token)) token = `${base}_${suffix++}`;
    occupied.add(token);
    return token;
  };
  let operatorCount = 0;
  /**
   * Adds operators or functions to the current compilation budget.
   *
   * ### Process Flow:
   * 1. Increase the shared count by the requested amount, defaulting to one.
   * 2. Reject the expression when the running count exceeds 300.
   *
   * @param amount - Number of operators/functions to add; defaults to one.
   * @returns Nothing; updates the enclosing operatorCount.
   * @throws If the running total exceeds 300.
   */
  const count = (amount = 1) => {
    operatorCount += amount;
    if (operatorCount > 300) throw new Error('Condition exceeds 300 operators and functions.');
  };
  /**
   * Renders a validated document path using reusable attribute-name aliases.
   *
   * ### Process Flow:
   * 1. Split attribute segments and bracketed list indexes.
   * 2. Preserve indexes and allocate or reuse an alias for each attribute segment.
   * 3. Join the segments into a DynamoDB document path.
   *
   * @param input - Previously validated attribute path, such as items[0].sku.
   * @returns An aliased document path; name mappings are recorded in the enclosing state.
   *
   * @example
   * ```ts
   * path('items[0].sku'); // '#conditionName0[0].#conditionName1' (with fresh state)
   * ```
   */
  const path = (input: string) =>
    (input.match(/[^.[\]]+|\[\d+\]/g) ?? [])
      .map((part, index) => {
        if (part.startsWith('[')) return part;
        let alias = aliases.get(part);
        if (!alias) {
          alias = allocate(occupiedNames, `#conditionName${aliases.size}`);
          aliases.set(part, alias);
          names[alias] = part;
        }
        return `${index > 0 ? '.' : ''}${alias}`;
      })
      .join('');
  /**
   * Stores a native comparison value under a generated expression-value placeholder.
   *
   * ### Process Flow:
   * 1. Allocate the next condition-value token without colliding with reserved tokens.
   * 2. Store the input value in the enclosing mapping.
   * 3. Return the generated token.
   *
   * @param input - Previously validated native DynamoDB value.
   * @returns The placeholder referencing the stored value.
   */
  const value = (input: unknown): string => {
    const token = allocate(occupiedValues, `:conditionValue${Object.keys(values).length}`);
    values[token] = input;
    return token;
  };
  /**
   * Renders a comparison, range, or membership check for a prepared subject expression.
   *
   * ### Process Flow:
   * 1. Identify the single comparison operator.
   * 2. Allocate value placeholders for its operand, bounds, or membership list.
   * 3. Combine the subject, DynamoDB operator, and generated tokens.
   *
   * @param subject - Aliased attribute path or size(...) expression.
   * @param operation - Validated comparator, BETWEEN bounds, or IN values.
   * @returns The comparison-expression fragment.
   */
  function comparison(subject: string, operation: ConditionComparison): string {
    if ('eq' in operation) return `${subject} = ${value(operation.eq)}`;
    if ('ne' in operation) return `${subject} <> ${value(operation.ne)}`;
    if ('lt' in operation) return `${subject} < ${value(operation.lt)}`;
    if ('lte' in operation) return `${subject} <= ${value(operation.lte)}`;
    if ('gt' in operation) return `${subject} > ${value(operation.gt)}`;
    if ('gte' in operation) return `${subject} >= ${value(operation.gte)}`;
    if ('between' in operation)
      return `${subject} BETWEEN ${value(operation.between[0])} AND ${value(operation.between[1])}`;
    return `${subject} IN (${operation.in.map(value).join(', ')})`;
  }
  /**
   * Recursively renders a validated condition tree while recording aliases, values, and operator usage.
   *
   * ### Process Flow:
   * 1. Count the current node and render logical children with explicit parentheses.
   * 2. For leaves, alias the attribute path and select the relevant comparison or function.
   * 3. Allocate referenced values and account for additional NOT or size functions.
   *
   * @param node - Validated condition leaf or logical group.
   * @returns The condition-expression fragment for this subtree.
   * @throws If the running operator/function budget exceeds 300.
   */
  function compile(node: Condition): string {
    count();
    if ('and' in node || 'or' in node) {
      const children = 'and' in node ? node.and : node.or;
      count(children.length - 2);
      return children.map((child) => `(${compile(child)})`).join('and' in node ? ' AND ' : ' OR ');
    }
    if ('not' in node) return `NOT (${compile(node.not)})`;
    const subject = path(node.attr);
    if ('exists' in node) return `attribute_exists(${subject})`;
    if ('notExists' in node) return `attribute_not_exists(${subject})`;
    if ('type' in node) return `attribute_type(${subject}, ${value(node.type)})`;
    if ('beginsWith' in node) return `begins_with(${subject}, ${value(node.beginsWith)})`;
    if ('contains' in node) return `contains(${subject}, ${value(node.contains)})`;
    if ('notContains' in node) {
      count();
      return `NOT (contains(${subject}, ${value(node.notContains)}))`;
    }
    if ('size' in node) {
      count();
      return comparison(`size(${subject})`, node.size);
    }
    return comparison(subject, node);
  }
  const expression = compile(condition);
  if (new TextEncoder().encode(expression).length > 4096) throw new Error('Condition expression exceeds 4 KB.');
  return { expression, expressionAttributeNames: names, expressionAttributeValues: values, operatorCount };
}
