import type { AttributeValue } from '@aws-sdk/client-dynamodb';

/**
 * Converts an object’s own enumerable string properties into DynamoDB AttributeValue objects.
 *
 * ### Process Flow:
 * 1. Iterate over the input object’s entries.
 * 2. Recursively convert primitives, binary data, arrays, sets, and object entries.
 * 3. Return an attribute map with the original property names.
 *
 * Sets are converted to lists (L), not SS/NS/BS. This helper does not validate finite numbers or detect cyclic input.
 *
 * @param values - Native JavaScript attributes to convert.
 * @returns An object containing low-level DynamoDB AttributeValue representations.
 * @throws A TypeError for unsupported value types, including undefined, functions, and symbols.
 *
 * @example
 * ```ts
 * marshall({ id: 'order-1', count: 2, archived: null });
 * // { id: { S: 'order-1' }, count: { N: '2' }, archived: { NULL: true } }
 * ```
 */
export function marshall(values: Record<string, unknown>): Record<string, AttributeValue> {
  /**
   * Recursively converts one native value into its low-level DynamoDB representation.
   *
   * ### Process Flow:
   * 1. Handle scalar and binary values directly.
   * 2. Recurse through arrays and sets as lists, or object entries as maps.
   * 3. Reject values without a supported representation.
   *
   * @param value - Native attribute value to convert.
   * @returns The converted AttributeValue.
   * @throws A TypeError for unsupported JavaScript value types.
   */
  const convert = (value: unknown): AttributeValue => {
    if (value === null) return { NULL: true };
    if (typeof value === 'string') return { S: value };
    if (typeof value === 'number' || typeof value === 'bigint') return { N: value.toString() };
    if (typeof value === 'boolean') return { BOOL: value };
    if (value instanceof Uint8Array) return { B: value };
    if (Array.isArray(value)) return { L: value.map(convert) };
    if (value instanceof Set) return { L: [...value].map(convert) };
    if (typeof value === 'object') {
      return {
        M: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, convert(item)])
        ),
      };
    }
    throw new TypeError(`Unsupported DynamoDB value: ${typeof value}`);
  };

  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, convert(value)]));
}
