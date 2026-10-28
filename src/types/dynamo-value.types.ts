import { dynamoNumericValueSch } from './key.types';
import { NumberValue } from '@aws-sdk/lib-dynamodb';
import { parseDynamoNumber } from '../utils/dynamo-number';
import { z } from 'zod';

/** Validates native DocumentClient values recursively without coercing or cloning them. */
export const dynamoValueSch = z.unknown().superRefine((value, ctx) => {
  const ancestors = new Set<object>();
  const reject = (path: PropertyKey[]) =>
    ctx.addIssue({
      code: 'custom',
      path,
      message: 'Values must be finite, acyclic DynamoDB values without undefined or empty/heterogeneous sets.',
    });
  const visit = (item: unknown, path: PropertyKey[]): void => {
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
      reject(path);
      return;
    }
    if (typeof item === 'number') {
      if (!dynamoNumericValueSch.safeParse(item).success) reject(path);
      return;
    }
    if (item instanceof NumberValue) {
      try {
        parseDynamoNumber(item.toString());
      } catch {
        reject(path);
      }
      return;
    }
    if (item === null || typeof item !== 'object' || item instanceof Uint8Array) return;
    if (ancestors.has(item)) {
      reject(path);
      return;
    }
    ancestors.add(item);
    if (item instanceof Set) {
      const entries = [...item];
      const kind = (entry: unknown) =>
        entry instanceof Uint8Array
          ? 'binary'
          : typeof entry === 'bigint' || entry instanceof NumberValue
            ? 'number'
            : typeof entry;
      if (
        entries.length === 0 ||
        !['string', 'number', 'binary'].includes(kind(entries[0])) ||
        !entries.every((entry) => kind(entry) === kind(entries[0]))
      )
        reject(path);
      else {
        const numericKinds = new Set(entries.map((entry) => (entry instanceof NumberValue ? 'wrapped' : typeof entry)));
        if (kind(entries[0]) === 'number' && numericKinds.size > 1) reject(path);
        else entries.forEach((entry, index) => visit(entry, [...path, index]));
      }
    } else if (Array.isArray(item)) {
      Array.from(item).forEach((entry, index) => visit(entry, [...path, index]));
    } else if (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null) {
      Object.entries(item).forEach(([key, entry]) => visit(entry, [...path, key]));
    } else reject(path);
    ancestors.delete(item);
  };
  visit(value, []);
});

/** Native document attributes validated recursively, retaining field-level issue paths. */
export const dynamoDocumentSch = z.record(z.string().min(1), dynamoValueSch);
