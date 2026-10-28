import { z } from 'zod';

export const dynamoValueSch = z.unknown().superRefine((value, ctx) => {
  const ancestors = new Set<object>();
  function visit(item: unknown): boolean {
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') return false;
    if (typeof item === 'number') return Number.isFinite(item);
    if (item === null || typeof item !== 'object' || item instanceof Uint8Array) return true;
    if (ancestors.has(item)) return false;
    ancestors.add(item);
    let valid: boolean;
    if (item instanceof Set) {
      const entries = [...item];
      const kind = (entry: unknown) =>
        entry instanceof Uint8Array ? 'binary' : typeof entry === 'bigint' ? 'number' : typeof entry;
      valid =
        entries.length > 0 &&
        ['string', 'number', 'binary'].includes(kind(entries[0])) &&
        entries.every((entry) => kind(entry) === kind(entries[0]) && visit(entry));
    } else if (Array.isArray(item)) {
      valid = Array.from(item).every(visit);
    } else {
      valid =
        (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null) &&
        Object.values(item).every(visit);
    }
    ancestors.delete(item);
    return valid;
  }
  if (!visit(value))
    ctx.addIssue({
      code: 'custom',
      message: 'Values must be finite, acyclic DynamoDB values without undefined or empty/heterogeneous sets.',
    });
});
