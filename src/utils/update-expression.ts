import { updateOperationsSch, updatePathSegments } from '../types/update.types';
import type { UpdateOperation } from '../types/update.types';
import type { ConditionTokenScope } from './condition-expression';

/**
 * Compiles structured updates into deterministic SET, REMOVE, ADD, and DELETE clauses.
 *
 * ### Process Flow:
 * 1. Validate operations, values, document paths, and nonoverlapping targets.
 * 2. Reserve caller tokens and allocate reusable path aliases and native-value placeholders.
 * 3. Render actions and common SET operations, preserving input order within each clause.
 * 4. Join nonempty clauses in SET, REMOVE, ADD, DELETE order.
 * 5. Enforce the 300-operator/function budget and 4 KB UTF-8 expression limit.
 *
 * Primary-key protection is performed by the command schema, which knows the supplied key. Existing item types and parent-map existence remain DynamoDB validations.
 *
 * @param input - Nonempty array of attribute-based update operations.
 * @param scope - Optional occupied expression-name and expression-value tokens to reserve.
 * @returns Update expression text and its generated name/value mappings.
 * @throws If validation fails or expression limits are exceeded.
 *
 * @example
 * ```ts
 * const result = compileUpdateExpression([
 *   { attr: 'status', set: 'CONFIRMED' },
 *   { attr: 'temporary', remove: true },
 * ]);
 * // result.expression: 'SET #updateName0 = :updateValue0 REMOVE #updateName1'
 * // result.expressionAttributeValues: { ':updateValue0': 'CONFIRMED' }
 * ```
 */
export function compileUpdateExpression(input: readonly UpdateOperation[], scope: ConditionTokenScope = {}) {
  const updates = updateOperationsSch.parse(input);
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const aliases = new Map<string, string>();
  const occupiedNames = new Set(scope.occupiedNameTokens);
  const occupiedValues = new Set(scope.occupiedValueTokens);
  /**
   * Reserves an update-expression placeholder without colliding with existing tokens.
   *
   * ### Process Flow:
   * 1. Try the preferred base token.
   * 2. Add numeric suffixes until a free token is found.
   * 3. Reserve the chosen token and return it.
   *
   * @param occupied - Mutable set of unavailable name or value tokens.
   * @param base - Desired token with its hash or colon prefix.
   * @returns The collision-safe reserved token.
   */
  const allocate = (occupied: Set<string>, base: string): string => {
    let token = base;
    let suffix = 1;
    while (occupied.has(token)) token = `${base}_${suffix++}`;
    occupied.add(token);
    return token;
  };
  /**
   * Aliases a validated update path and canonicalizes its list indexes.
   *
   * ### Process Flow:
   * 1. Tokenize the path into attribute segments and canonical bracketed indexes.
   * 2. Allocate or reuse a name alias for each attribute segment.
   * 3. Reassemble the aliased path while preserving list-index syntax.
   *
   * @param attr - Validated target or source path, such as profile.addresses[0].city.
   * @returns An aliased path; its attribute-name mappings are recorded in the enclosing state.
   */
  const path = (attr: string): string =>
    updatePathSegments(attr)
      .map((segment, index) => {
        if (segment.startsWith('[')) return segment;
        let alias = aliases.get(segment);
        if (!alias) {
          alias = allocate(occupiedNames, `#updateName${aliases.size}`);
          aliases.set(segment, alias);
          names[alias] = segment;
        }
        return `${index > 0 ? '.' : ''}${alias}`;
      })
      .join('');
  /**
   * Registers a literal update operand under a collision-safe value token.
   *
   * ### Process Flow:
   * 1. Allocate the next available update-value token.
   * 2. Store the native operand in the enclosing value map.
   * 3. Return the token for use in an update clause.
   *
   * @param input - Previously validated native DynamoDB operand.
   * @returns The placeholder referencing the stored operand.
   */
  const value = (input: unknown): string => {
    const token = allocate(occupiedValues, `:updateValue${Object.keys(values).length}`);
    values[token] = input;
    return token;
  };
  const clauses: Record<'SET' | 'REMOVE' | 'ADD' | 'DELETE', string[]> = { SET: [], REMOVE: [], ADD: [], DELETE: [] };
  let operatorCount = 0;
  for (const operation of updates) {
    const target = path(operation.attr);
    if ('remove' in operation) clauses.REMOVE.push(target);
    else if ('add' in operation) clauses.ADD.push(`${target} ${value(operation.add)}`);
    else if ('delete' in operation) clauses.DELETE.push(`${target} ${value(operation.delete)}`);
    else {
      operatorCount++; // SET assignment
      let source: string;
      if ('set' in operation) source = value(operation.set);
      else if ('ifNotExists' in operation) {
        operatorCount++;
        source = `if_not_exists(${target}, ${value(operation.ifNotExists)})`;
      } else if ('copyFrom' in operation) source = path(operation.copyFrom);
      else if ('increment' in operation) {
        operatorCount++;
        source = `${target} + ${value(operation.increment)}`;
      } else if ('decrement' in operation) {
        operatorCount++;
        source = `${target} - ${value(operation.decrement)}`;
      } else if ('append' in operation) {
        operatorCount++;
        source = `list_append(${target}, ${value(operation.append)})`;
      } else {
        operatorCount++;
        source = `list_append(${value(operation.prepend)}, ${target})`;
      }
      clauses.SET.push(`${target} = ${source}`);
    }
  }
  const expression = Object.entries(clauses)
    .filter(([, actions]) => actions.length > 0)
    .map(([action, parts]) => `${action} ${parts.join(', ')}`)
    .join(' ');
  if (operatorCount > 300) throw new Error('Update exceeds 300 operators and functions.');
  if (new TextEncoder().encode(expression).length > 4096) throw new Error('Update expression exceeds 4 KB.');
  return { expression, expressionAttributeNames: names, expressionAttributeValues: values };
}
