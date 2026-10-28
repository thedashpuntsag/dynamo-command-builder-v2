import { z } from 'zod';

/** Native numeric operands must not silently lose integer precision. */
export const dynamoNumericValueSch = z.union([
  z
    .number()
    .finite()
    .refine(
      (value) => !Number.isInteger(value) || Number.isSafeInteger(value),
      'Use bigint for integers outside the safe number range.'
    ),
  z.bigint(),
]);
/** A native DynamoDB key scalar; key names are literal and are never trimmed. */
export const dynamoKeyValueSch = z.union([
  z.string().min(1),
  dynamoNumericValueSch,
  z.instanceof(Uint8Array).refine((value) => value.length > 0, 'Binary key values must not be empty.'),
]);
export type DynamoKeyValue = z.infer<typeof dynamoKeyValueSch>;
export const dynamoPrimaryKeySch = z.record(z.string().min(1), dynamoKeyValueSch).refine((key) => {
  const count = Object.keys(key).length;
  return count >= 1 && count <= 2;
}, 'Key must contain a partition key and optional sort key.');
export const dynamoPaginationKeySch = z
  .record(z.string().min(1), dynamoKeyValueSch)
  .refine((key) => Object.keys(key).length > 0, 'Pagination key must not be empty.');

/**
 * Creates a stable identity for an already validated key, including bigint and binary values.
 *
 * ### Process Flow:
 * 1. Sort literal attribute names.
 * 2. Encode scalar values with type tags, normalizing integral numbers and bigints.
 * 3. Return the JSON encoding of the sorted entries.
 *
 * @param key - A validated key record.
 * @returns A canonical identity suitable for duplicate detection.
 */
export function dynamoKeyIdentity(key: Record<string, DynamoKeyValue>): string {
  return JSON.stringify(
    Object.keys(key)
      .sort()
      .map((name) => {
        const value = key[name]!;
        if (value instanceof Uint8Array) return [name, 'B', Array.from(value)];
        if (typeof value === 'number' || typeof value === 'bigint') return [name, 'N', String(value)];
        return [name, 'S', value];
      })
  );
}
