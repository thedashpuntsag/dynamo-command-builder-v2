/**
 * Extracts expression attribute names from a DynamoDB expression.
 *
 * ### Process flow:
 * 1. Find each expression attribute-name token beginning with `#`.
 * 2. Add an entry mapping each token to its unprefixed name.
 * 3. Return the resulting record of expression attribute names.
 *
 * @param {string} expression - The projection expression string.
 * @returns {Record<string, string>} - A record of expression attribute names.
 */
export function extractExpAttributeNamesFromExpression(expression: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [token] of expression.matchAll(/#[A-Za-z0-9_]+/g)) {
    result[token] = token.slice(1);
  }

  return result;
}

/**
 * Extracts expression attribute names from a DynamoDB UPDATE expression.
 *
 * Example:
 *   'SET #size = :size, #count = :count' → { '#size': 'size', '#count': 'count' }
 *
 * ### Process flow:
 * 1. Remove the leading "SET " from the expression.
 * 2. Split the remaining string by commas to get individual assignments.
 * 3. For each assignment, split by '=' to isolate the attribute name.
 * 4. Trim whitespace and check if the attribute name starts with '#'.
 * 5. If it does, add an entry to the result object mapping the attribute name to its unprefixed version.
 * 6. Return the resulting record of expression attribute names.
 *
 * @param {string} expression - The DynamoDB UPDATE expression.
 * @returns {Record<string, string>} - A record of expression attribute names.
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
