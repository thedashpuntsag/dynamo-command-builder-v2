import { dynamoValueSch as valueSch } from './dynamo-value.types';
import { z } from 'zod';

export const conditionPathSch = z
  .string()
  .min(1)
  .refine((path) => {
    if (!/^[^.[\]]+(?:\[\d+\]|\.[^.[\]]+)*$/.test(path)) return false;
    return (path.match(/\.|\[/g)?.length ?? 0) <= 32;
  }, 'Invalid document path or more than 32 dereferences.');

const attributeTypeSch = z.enum(['S', 'SS', 'N', 'NS', 'B', 'BS', 'BOOL', 'NULL', 'L', 'M']);
export type DynamoAttributeType = z.infer<typeof attributeTypeSch>;
export type ConditionComparison =
  | { eq: unknown }
  | { ne: unknown }
  | { lt: unknown }
  | { lte: unknown }
  | { gt: unknown }
  | { gte: unknown }
  | { between: readonly [unknown, unknown] }
  | { in: readonly unknown[] };
export type ConditionOperation =
  | ConditionComparison
  | { beginsWith: string | Uint8Array }
  | { contains: unknown }
  | { notContains: unknown }
  | { type: DynamoAttributeType }
  | { exists: true }
  | { notExists: true }
  | { size: ConditionComparison };
/** A leaf names its attribute and one operator; logical groups nest conditions. */
export type Condition =
  | ({ attr: string } & ConditionOperation)
  | { and: readonly Condition[] }
  | { or: readonly Condition[] }
  | { not: Condition };

const comparisons = [
  z.object({ eq: valueSch }).strict(),
  z.object({ ne: valueSch }).strict(),
  z.object({ lt: valueSch }).strict(),
  z.object({ lte: valueSch }).strict(),
  z.object({ gt: valueSch }).strict(),
  z.object({ gte: valueSch }).strict(),
  z.object({ between: z.tuple([valueSch, valueSch]) }).strict(),
  z.object({ in: z.array(valueSch).min(1).max(100) }).strict(),
] as const;
const sizeSch = z.union(comparisons);
const operationSchemas = [
  ...comparisons,
  z.object({ beginsWith: z.union([z.string(), z.instanceof(Uint8Array)]) }).strict(),
  z.object({ contains: valueSch }).strict(),
  z.object({ notContains: valueSch }).strict(),
  z.object({ type: attributeTypeSch }).strict(),
  z.object({ exists: z.literal(true) }).strict(),
  z.object({ notExists: z.literal(true) }).strict(),
  z.object({ size: sizeSch }).strict(),
] as const;
const conditionNodeSch: z.ZodType<Condition, Condition> = z.lazy(() =>
  z.union([
    ...operationSchemas.map((schema) => schema.extend({ attr: conditionPathSch }).strict()),
    z.object({ and: z.array(conditionNodeSch).min(2) }).strict(),
    z.object({ or: z.array(conditionNodeSch).min(2) }).strict(),
    z.object({ not: conditionNodeSch }).strict(),
  ])
);
const recordValueSch = z.union([
  ...operationSchemas,
  valueSch.refine(
    (value) =>
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value instanceof Set ||
      value instanceof Uint8Array,
    'Map equality requires { eq: value }.'
  ),
]);
export type ConditionRecordValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | Uint8Array
  | readonly unknown[]
  | ReadonlySet<unknown>
  | ConditionOperation;
export type ConditionRecord = Record<string, ConditionRecordValue>;
export const conditionRecordSch = z
  .record(conditionPathSch, recordValueSch)
  .refine((record) => Object.keys(record).length > 0, 'conditions must not be empty.') as unknown as z.ZodType<
  ConditionRecord,
  ConditionRecord
>;

// Check cycles before the recursive schema traverses condition nodes or map values.
export const conditionSch = z
  .custom<Condition>((input) => {
    const active = new Set<object>();
    const completed = new Set<object>();
    const stack: Array<{ value: unknown; exit: boolean }> = [{ value: input, exit: false }];
    while (stack.length > 0) {
      const { value, exit } = stack.pop()!;
      if (value === null || typeof value !== 'object' || value instanceof Uint8Array) continue;
      if (exit) {
        active.delete(value);
        completed.add(value);
        continue;
      }
      if (active.has(value)) return false;
      if (completed.has(value)) continue;
      active.add(value);
      stack.push({ value, exit: true });
      for (const child of value instanceof Set ? value : Object.values(value))
        stack.push({ value: child, exit: false });
    }
    return true;
  }, 'Conditions must be acyclic.')
  .pipe(conditionNodeSch);
