import { z } from 'zod';
import { conditionPathSch } from './condition.types';
import { dynamoValueSch } from './dynamo-value.types';

const updatePathSch = conditionPathSch.refine(
  (path) => (path.match(/\[\d+\]/g) ?? []).every((index) => Number.isSafeInteger(Number(index.slice(1, -1)))),
  'List indexes must be safe nonnegative integers.'
);
const numberSch = z.union([z.number().finite(), z.bigint()]);
const setSch = z.instanceof(Set).superRefine((value, ctx) => {
  const result = dynamoValueSch.safeParse(value);
  if (!result.success)
    for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', message: issue.message });
});
const listSch = z.array(dynamoValueSch);

/** Each structured update names an attribute path and exactly one operation. */
export type UpdateOperation = { attr: string } & (
  | { set: unknown }
  | { remove: true }
  | { add: number | bigint | ReadonlySet<unknown> }
  | { delete: ReadonlySet<unknown> }
  | { increment: number | bigint }
  | { decrement: number | bigint }
  | { append: readonly unknown[] }
  | { prepend: readonly unknown[] }
  | { ifNotExists: unknown }
  | { copyFrom: string }
);

export const updateOperationSch: z.ZodType<UpdateOperation, UpdateOperation> = z
  .union([
    z.object({ attr: updatePathSch, set: dynamoValueSch }).strict(),
    z.object({ attr: updatePathSch, remove: z.literal(true) }).strict(),
    z.object({ attr: updatePathSch, add: z.union([numberSch, setSch]) }).strict(),
    z.object({ attr: updatePathSch, delete: setSch }).strict(),
    z.object({ attr: updatePathSch, increment: numberSch }).strict(),
    z.object({ attr: updatePathSch, decrement: numberSch }).strict(),
    z.object({ attr: updatePathSch, append: listSch }).strict(),
    z.object({ attr: updatePathSch, prepend: listSch }).strict(),
    z.object({ attr: updatePathSch, ifNotExists: dynamoValueSch }).strict(),
    z.object({ attr: updatePathSch, copyFrom: updatePathSch }).strict(),
  ])
  .superRefine((operation, ctx) => {
    if (
      ('add' in operation || 'delete' in operation) &&
      (operation.attr.includes('.') || operation.attr.includes('['))
    ) {
      ctx.addIssue({ code: 'custom', path: ['attr'], message: 'ADD and DELETE only support top-level attributes.' });
    }
  });

/** Tokenize paths so overlap checks compare complete segments and canonical indexes. */
export function updatePathSegments(path: string): string[] {
  return (path.match(/[^.[\]]+|\[\d+\]/g) ?? []).map((part) =>
    part.startsWith('[') ? `[${Number(part.slice(1, -1))}]` : part
  );
}

export const updateOperationsSch: z.ZodType<readonly UpdateOperation[], readonly UpdateOperation[]> = z
  .array(updateOperationSch)
  .min(1)
  .max(300)
  .superRefine((updates, ctx) => {
    const targets: string[][] = [];
    updates.forEach((operation, index) => {
      const segments = updatePathSegments(operation.attr);
      if (
        targets.some((other) => {
          const length = Math.min(other.length, segments.length);
          return other.slice(0, length).every((segment, index) => segment === segments[index]);
        })
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'attr'],
          message: 'Update targets must not duplicate or overlap another target.',
        });
      }
      targets.push(segments);
    });
  });

export function validateUpdateMode(
  input: {
    key: Record<string, unknown>;
    item?: Record<string, unknown> | undefined;
    updates?: readonly UpdateOperation[] | undefined;
    updateExpression?: string | undefined;
  },
  ctx: z.RefinementCtx
): void {
  if ([input.item, input.updates, input.updateExpression].filter((value) => value !== undefined).length !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['updates'],
      message: 'Provide exactly one of item, updates, or updateExpression.',
    });
  }
  input.updates?.forEach((operation, index) => {
    const root = updatePathSegments(operation.attr)[0]!;
    if (Object.hasOwn(input.key, root))
      ctx.addIssue({
        code: 'custom',
        path: ['updates', index, 'attr'],
        message: 'Primary-key attributes cannot be updated.',
      });
  });
}
