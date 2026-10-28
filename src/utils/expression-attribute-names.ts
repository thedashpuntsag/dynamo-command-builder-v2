/**
 * Infers alias mappings from hash-prefixed tokens in any DynamoDB expression.
 *
 * ### Process Flow:
 * 1. Find tokens matching a hash followed by letters, digits, or underscores.
 * 2. Map each token to the same text without its leading hash.
 * 3. Return the mappings, retaining one entry per distinct token.
 *
 * @param expression - Condition, projection, filter, or update expression to scan.
 * @returns Inferred name mappings; explicit caller mappings may override them.
 *
 * @example
 * ```ts
 * extractExpAttributeNamesFromExpression('#status = :status AND attribute_exists(#id)');
 * // { '#status': 'status', '#id': 'id' }
 * ```
 */
export function extractExpAttributeNamesFromExpression(expression: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [token] of expression.matchAll(/#[A-Za-z0-9_]+/g)) {
    result[token] = token.slice(1);
  }

  return result;
}

/**
 * Infers aliases from left-hand sides of simple comma-separated SET assignments.
 *
 * ### Process Flow:
 * 1. Remove a leading SET keyword and surrounding whitespace.
 * 2. Split on commas and take the left-hand side of each assignment.
 * 3. Keep hash-prefixed left-hand sides and map them to their unprefixed text.
 *
 * This helper does not parse the full update grammar or commas inside function calls; use extractExpAttributeNamesFromExpression to scan all tokens.
 *
 * @param expression - Simple SET expression to inspect.
 * @returns Mappings for hash-prefixed assignment targets.
 *
 * @example
 * ```ts
 * extractExpAttributeNamesFromUpdateExp('SET #status = :next, #count = :count');
 * // { '#status': 'status', '#count': 'count' }
 * ```
 */
export function extractExpAttributeNamesFromUpdateExp(expression: string): Record<string, string> {
  const result: Record<string, string> = {};

  // Remove leading "SET " (case-insensitive) and surrounding whitespace
  const body = expression.replace(/^\s*SET\s+/i, '').trim();
  if (!body) return result;

  // Split on commas between assignments
  const assignments = body.split(',');

  for (const assignment of assignments) {
    const leftSide = assignment.split('=')[0]?.trim();
    if (!leftSide || !leftSide.startsWith('#')) continue;

    result[leftSide] = leftSide.slice(1);
  }

  return result;
}
