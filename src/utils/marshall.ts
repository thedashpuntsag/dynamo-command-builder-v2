import type { AttributeValue } from '@aws-sdk/client-dynamodb';

/**
 * Marshalls a plain JavaScript object into a DynamoDB-compatible format.
 * Converts nested objects, arrays, sets, and primitive types into the corresponding DynamoDB AttributeValue format.
 *
 * @param values The plain JavaScript object to be marshalled into DynamoDB format.
 * @returns The DynamoDB-compatible representation of the input object.
 */
export function marshall(values: Record<string, unknown>): Record<string, AttributeValue> {
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
