import { Buffer } from 'node:buffer';

/**
 * Converts a legacy string-encoded DynamoDB value into a native JavaScript value.
 *
 * ### Process Flow:
 * 1. Select conversion behavior from the supplied type code.
 * 2. Convert scalars, parse JSON for M/L, or split comma-separated SS/NS/BS entries.
 * 3. Return the converted value, filtering invalid numeric entries from NS.
 *
 * This is a converter, not a strict schema validator: N uses Number(), BOOL compares against "true" case-insensitively, and set codes return arrays.
 *
 * @param key - Encoded scalar, JSON text, or comma-separated collection.
 * @param keyType - Type code: S, N, BOOL, NULL, M, L, SS, NS, or BS.
 * @returns A scalar, parsed JSON value, array, or array of Node.js Buffers.
 * @throws If the type code is unsupported or M/L contains malformed JSON.
 *
 * @example
 * ```ts
 * parseDynamoKeyValue('123', 'N'); // 123
 * parseDynamoKeyValue('red, blue', 'SS'); // ['red', 'blue']
 * parseDynamoKeyValue('{"enabled":true}', 'M'); // { enabled: true }
 * ```
 */
export function parseDynamoKeyValue(key: string, keyType: string): unknown {
  switch (keyType) {
    case 'S': // String
      return key;
    case 'N': // Number
      return Number(key);
    case 'BOOL': // Boolean
      return key.toLowerCase() === 'true';
    case 'NULL': // Null
      return null;
    case 'M': // Map (JSON string)
      try {
        return JSON.parse(key);
      } catch {
        throw new Error('Invalid JSON format for partitionKeyType M (Map)');
      }
    case 'L': // List (JSON array)
      try {
        return JSON.parse(key);
      } catch {
        throw new Error('Invalid JSON format for partitionKeyType L (List)');
      }
    case 'SS': // String Set
      return key.split(',').map((item) => item.trim());
    case 'NS': // Number Set
      return key
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((num) => !isNaN(num));
    case 'BS': // Binary Set
      return key.split(',').map((item) => Buffer.from(item.trim(), 'base64'));
    default:
      throw new Error(`Unsupported partitionKeyType: ${keyType}`);
  }
}
