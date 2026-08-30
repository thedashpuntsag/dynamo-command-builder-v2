import { z } from 'zod';

import type { DynamoReadQueryRequest } from './query-request.types';
import {
  dynamoAttrTypeSch,
  dynamoKeyAttrTypeSch,
  requiredStringSch,
  returnConsumedCapacityOptionsSch,
} from './utility.types';

const keySch = z.record(z.string().min(1), z.unknown()).refine((key) => Object.keys(key).length > 0, {
  message: 'key must contain at least one attribute.',
});

const projectionFields = {
  projectionExpression: z.string().trim().min(1).optional(),
  expressionAttributeNames: z.record(z.string().min(1), z.string().min(1)).optional(),
  returnConsumedCapacity: returnConsumedCapacityOptionsSch.optional(),
};

/**
 * Schema for a single DynamoDB GetItem request.
 *
 * Validates the target table, primary-key payload, optional read consistency,
 * and projection metadata for a standard GET operation.
 */
export const dynamoGetRequestSch = z
  .object({
    operation: z.literal('GET'),
    table: requiredStringSch,
    key: keySch,
    consistentRead: z.boolean().optional(),
    ...projectionFields,
  })
  .strict();
export type DynamoGetRequest = z.infer<typeof dynamoGetRequestSch>;

const batchTableSch = z
  .object({
    keys: z.array(keySch).min(1),
    consistentRead: z.boolean().optional(),
    projectionExpression: z.string().trim().min(1).optional(),
    expressionAttributeNames: z.record(z.string().min(1), z.string().min(1)).optional(),
  })
  .strict();

/**
 * Schema for a DynamoDB BatchGetItem request.
 *
 * Ensures each table has at least one key, caps the total number of keys,
 * and rejects duplicate key combinations within the same batch.
 */
export const dynamoBatchGetRequestSch = z
  .object({
    operation: z.literal('BATCH_GET'),
    requestItems: z
      .record(requiredStringSch, batchTableSch)
      .refine((items) => Object.keys(items).length > 0, 'BatchGet requires at least one table.')
      .refine(
        (items) => Object.values(items).reduce((count, item) => count + item.keys.length, 0) <= 100,
        'BatchGet supports at most 100 keys.'
      ),
    returnConsumedCapacity: z.enum(['INDEXES', 'TOTAL', 'NONE']).optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    const seen = new Set<string>();
    for (const [table, item] of Object.entries(request.requestItems)) {
      item.keys.forEach((key, index) => {
        const identity = `${table}:${JSON.stringify(key, Object.keys(key).sort())}`;
        if (seen.has(identity)) {
          ctx.addIssue({
            code: 'custom',
            path: ['requestItems', table, 'keys', index],
            message: 'Duplicate BatchGet key.',
          });
        }
        seen.add(identity);
      });
    }
  });
export type DynamoBatchGetRequest = z.infer<typeof dynamoBatchGetRequestSch>;

const transactItemSch = z
  .object({
    table: requiredStringSch,
    key: keySch,
    projectionExpression: z.string().trim().min(1).optional(),
    expressionAttributeNames: z.record(z.string().min(1), z.string().min(1)).optional(),
  })
  .strict();

/**
 * Schema for a DynamoDB TransactGetItem request.
 *
 * Covers a transaction batch of up to 100 read operations while validating
 * the table, key, and optional projection metadata for each item.
 */
export const dynamoTransactGetRequestSch = z
  .object({
    operation: z.literal('TRANSACT_GET'),
    transactItems: z.array(transactItemSch).min(1).max(100),
    returnConsumedCapacity: z.enum(['INDEXES', 'TOTAL', 'NONE']).optional(),
  })
  .strict();
export type DynamoTransactGetRequest = z.infer<typeof dynamoTransactGetRequestSch>;

export type DynamoKeyDefinition = { name: string; valueType: z.infer<typeof dynamoKeyAttrTypeSch> };
export type DynamoTargetMetadata = {
  table: { partitionKeys: DynamoKeyDefinition[]; sortKeys: DynamoKeyDefinition[] };
  indexes?: Record<
    string,
    { kind: 'LSI' | 'GSI'; partitionKeys: DynamoKeyDefinition[]; sortKeys: DynamoKeyDefinition[] }
  >;
};

/**
 * Validates a parsed DynamoDB Query request against the actual table or index key schema.
 *
 * ### Process flow:
 * 1. Return early when the request is not a QUERY operation.
 * 2. Resolve the target table or index metadata from the request's index lookup.
 * 3. Reject invalid consistent-read usage for GSIs before checking key slots.
 * 4. Detect any gaps in the ordered pkAttr/skAttr slot sequences.
 * 5. Validate the partition-key conditions against the target's partition key metadata.
 * 6. Validate the sort-key conditions against the target's sort key metadata, while enforcing
 *    that any non-equality comparator appears only at the final slot.
 * 7. Prevent query filter names from referencing key attributes.
 *
 * @param request The parsed DynamoDB Query request to validate.
 * @param metadata The target table or index metadata to validate against.
 * @returns The validated DynamoDB Query request.
 */
export function validateDynamoReadQueryRequest(
  request: DynamoReadQueryRequest,
  metadata: DynamoTargetMetadata
): DynamoReadQueryRequest {
  if (request.operation !== 'QUERY') return request;
  const rawRequest = request as unknown as Record<string, unknown>;
  const target = request.index ? metadata.indexes?.[request.index as string] : metadata.table;
  if (!target) throw new Error(`Unknown DynamoDB target: ${request.index ?? request.table}`);
  if (request.consistentRead && request.index && metadata.indexes?.[request.index]?.kind === 'GSI') {
    throw new Error('Consistent reads are not supported on global secondary indexes.');
  }

  if (hasSlotGap(rawRequest, 'pkAttr', 4) || hasSlotGap(rawRequest, 'skAttr', 4)) {
    throw new Error('Query key slots must be continuous.');
  }
  const partitions = slots(rawRequest, 'pkAttr', 4);
  if (partitions.length !== target.partitionKeys.length) {
    throw new Error(`Query requires ${target.partitionKeys.length} partition-key conditions.`);
  }
  target.partitionKeys.forEach((key, index) => {
    const slot = partitions[index];
    if (!slot || slot.name !== key.name || (slot.valueType && slot.valueType !== key.valueType)) {
      throw new Error(`Partition-key slot ${index + 1} does not match target metadata.`);
    }
  });

  const sorts = slots(rawRequest, 'skAttr', 4);
  if (sorts.length > target.sortKeys.length) throw new Error('Too many sort-key conditions for the target.');
  let foundInequality = false;
  sorts.forEach((slot, index) => {
    const key = target.sortKeys[index];
    if (!key || slot.name !== key.name || (slot.valueType && slot.valueType !== key.valueType)) {
      throw new Error(`Sort-key slot ${index + 1} does not match target metadata.`);
    }
    if (foundInequality || (slot.condition && slot.condition !== 'EQUAL_TO')) {
      if (foundInequality || index !== sorts.length - 1)
        throw new Error('A non-equality sort-key condition must be final.');
      foundInequality = true;
    }
  });

  const keyNames = new Set([...target.partitionKeys, ...target.sortKeys].map((key) => key.name));
  for (let index = 1; index <= 5; index++) {
    const filterName = rawRequest[`filterAttr${index}Name`];
    if (typeof filterName === 'string' && keyNames.has(filterName)) {
      throw new Error('Query filters cannot target key attributes.');
    }
  }
  return request;
}

function slots(
  request: Record<string, unknown>,
  prefix: 'pkAttr' | 'skAttr',
  count: number
): Array<{ name: string | undefined; valueType: string | undefined; condition: string | undefined }> {
  const result: Array<{ name: string | undefined; valueType: string | undefined; condition: string | undefined }> = [];
  for (let index = 1; index <= count; index++) {
    const name = request[`${prefix}${index}Name`];
    if (name === undefined) break;
    result.push({
      name: name as string,
      valueType: request[`${prefix}${index}ValueType`] as string | undefined,
      condition: request[`${prefix}${index}Condition`] as string | undefined,
    });
  }
  return result;
}

/**
 * Checks if there are gaps in the sequence of attribute slots in a DynamoDB request.
 * A gap occurs when an earlier slot is empty but a later slot is populated.
 *
 * @param request The DynamoDB request object containing attribute slots.
 * @param prefix The prefix of the attribute slots to check ('pkAttr' or 'skAttr').
 * @param count The number of attribute slots to check.
 * @returns True if there is a gap in the sequence of attribute slots, false otherwise.
 */
function hasSlotGap(request: Record<string, unknown>, prefix: 'pkAttr' | 'skAttr', count: number): boolean {
  let foundEmpty = false;
  for (let index = 1; index <= count; index++) {
    const populated = [
      request[`${prefix}${index}Name`],
      request[`${prefix}${index}Value`],
      request[`${prefix}${index}Value2`],
      request[`${prefix}${index}Condition`],
      request[`${prefix}${index}ValueType`],
    ].some((value) => value !== undefined);
    if (!populated) foundEmpty = true;
    if (populated && foundEmpty) return true;
  }
  return false;
}

/**
 * Decodes a typed DynamoDB value from its wire-format string into a native JavaScript value.
 *
 * ### Process flow:
 * 1. Handle the special-case NULL type before any value parsing.
 * 2. Reject missing values for all non-NULL types.
 * 3. Decode scalar values for S, N, and BOOL using the DynamoDB rules for each type.
 * 4. Decode binary payloads through the base64 conversion helper.
 * 5. Parse JSON-based collections such as SS, NS, L, and M when the payload is structured.
 * 6. Throw a clear error for unsupported or malformed value encodings.
 *
 * @param value The string representation of the value to decode.
 * @param valueType The DynamoDB type of the value.
 * @returns The decoded native JavaScript value.
 */
export function decodeDynamoValue(value: string | undefined, valueType: z.infer<typeof dynamoAttrTypeSch>): unknown {
  if (valueType === 'NULL') return null;
  if (value === undefined) throw new Error(`${valueType} requires a value.`);
  if (valueType === 'S') return value;
  if (valueType === 'N') {
    const number = Number(value);
    if (!Number.isFinite(number) || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value))
      throw new Error('Invalid DynamoDB number.');
    return number;
  }
  if (valueType === 'BOOL') {
    if (value !== 'true' && value !== 'false') throw new Error('BOOL must be true or false.');
    return value === 'true';
  }
  const rawValue = value;
  if (valueType === 'B' || valueType === 'BS') return decodeBase64(rawValue);
  if (['SS', 'NS', 'L', 'M'].includes(valueType)) {
    try {
      return JSON.parse(rawValue);
    } catch {
      throw new Error(`${valueType} requires valid JSON.`);
    }
  }
  throw new Error(`Unsupported DynamoDB value type: ${valueType}`);
}

/**
 * Decodes a base64-encoded string into a Uint8Array.
 * @param value The base64-encoded string to decode.
 * @returns A Uint8Array representing the decoded binary data.
 */
function decodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid base64 binary value.');
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const firstChar = value[index] ?? '=';
    const secondChar = value[index + 1] ?? '=';
    const thirdChar = value[index + 2] ?? '=';
    const fourthChar = value[index + 3] ?? '=';
    const first = alphabet.indexOf(firstChar);
    const second = alphabet.indexOf(secondChar);
    const third = thirdChar === '=' ? 0 : alphabet.indexOf(thirdChar);
    const fourth = fourthChar === '=' ? 0 : alphabet.indexOf(fourthChar);
    bytes.push((first << 2) | (second >> 4));
    if (thirdChar !== '=') bytes.push(((second & 15) << 4) | (third >> 2));
    if (fourthChar !== '=') bytes.push(((third & 3) << 6) | fourth);
  }
  return Uint8Array.from(bytes);
}
