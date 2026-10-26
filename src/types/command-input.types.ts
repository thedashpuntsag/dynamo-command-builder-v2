import { z } from 'zod';
import {
  genericRecordSch,
  optStringSch,
  returnConsumedCapacityOptionsSch,
  returnItemCollectionMetricsOptionsSch,
  returnValuesOptionsSch,
  stringRecordSch,
} from './utility.types';

const trimmedRequiredStringSch = z.string().trim().min(1);
const returnValuesOnConditionCheckFailureSch = z.enum(['NONE', 'ALL_OLD']).default('NONE');
const expressionNameTokenSch = z.string().regex(/^#[A-Za-z0-9_]+$/);
const expressionValueTokenSch = z.string().regex(/^:[A-Za-z0-9_]+$/);
const expressionNamesSch = z.record(expressionNameTokenSch, z.string().min(1));
const expressionValuesSch = z.record(expressionValueTokenSch, z.unknown());

const oneOrTwoAttributeRecordSch = genericRecordSch.refine(
  (record) => {
    const attributeCount = Object.keys(record).length;

    return attributeCount === 1 || attributeCount === 2;
  },
  {
    message: 'Key must contain exactly 1 or 2 attributes.',
  }
);

type ExpressionMappingInput = {
  conditionExpression?: string | undefined;
  expressionAttributeNames?: Record<string, string> | undefined;
  expressionAttributeValues?: Record<string, unknown> | undefined;
};

function validateConditionExpressionMappings(
  input: ExpressionMappingInput,
  ctx: z.RefinementCtx,
  operation?: 'PUT' | 'DELETE'
): void {
  if (input.conditionExpression) return;

  const operationSuffix = operation ? ` for a ${operation} operation` : '';

  if (input.expressionAttributeNames) {
    ctx.addIssue({
      code: 'custom',
      path: ['expressionAttributeNames'],
      message: `expressionAttributeNames requires conditionExpression${operationSuffix}.`,
    });
  }

  if (input.expressionAttributeValues) {
    ctx.addIssue({
      code: 'custom',
      path: ['expressionAttributeValues'],
      message: `expressionAttributeValues requires conditionExpression${operationSuffix}.`,
    });
  }
}

function validateUniqueTableNames(tables: readonly { tableName: string }[], ctx: z.RefinementCtx): void {
  const tableNames = new Set<string>();

  tables.forEach(({ tableName }, index) => {
    if (tableNames.has(tableName)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate table "${tableName}" is not allowed.`,
        path: ['tables', index, 'tableName'],
      });
    }

    tableNames.add(tableName);
  });
}

// --------------------------------------- Batch get command schemas ---------------------------------------------------

export const keyValueSch = z.union([
  z.string().min(1),
  z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
]);
export type KeyValue = z.infer<typeof keyValueSch>;

export const deleteKeySch = z.record(z.string().min(1), keyValueSch).refine(
  (key) => {
    const keyCount = Object.keys(key).length;
    return keyCount >= 1 && keyCount <= 2;
  },
  {
    message: 'Key must contain a partition key and optional sort key.',
  }
);
export type DeleteKey = z.infer<typeof deleteKeySch>;

export const batchGetTableSch = z
  .object({
    tableName: z.string().min(1).max(1024),
    keys: z
      .array(z.record(z.string().min(1), keyValueSch))
      .min(1)
      .max(100),
    attributes: z.array(z.string().min(1)).min(1).optional(),
    consistentRead: z.boolean().default(false),
  })
  .strict();

export const customBatchGetCmdInputSch = z
  .object({
    tables: z.array(batchGetTableSch).min(1).max(100),

    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),
  })
  .strict()
  .superRefine(({ tables }, ctx) => {
    validateUniqueTableNames(tables, ctx);

    const totalKeyCount = tables.reduce((count, table) => count + table.keys.length, 0);

    if (totalKeyCount > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A BatchGetItem request supports at most 100 keys in total.',
        path: ['tables'],
      });
    }
  });

export type CustomBatchGetCmdInput = z.input<typeof customBatchGetCmdInputSch>;

// --------------------------------------- Batch write command schemas -------------------------------------------------
const batchWriteKeySchemaSch = z
  .object({
    partitionKey: z.string().min(1),
    sortKey: z.string().min(1).optional(),
  })
  .strict()
  .refine(({ partitionKey, sortKey }) => partitionKey !== sortKey, {
    message: 'Partition key and sort key must be different.',
    path: ['sortKey'],
  });

const batchPutOperationSch = z
  .object({
    operation: z.literal('PUT'),
    item: genericRecordSch,
  })
  .strict();

const batchDeleteOperationSch = z
  .object({
    operation: z.literal('DELETE'),
    key: genericRecordSch,
  })
  .strict();

const batchWriteOperationSch = z.discriminatedUnion('operation', [batchPutOperationSch, batchDeleteOperationSch]);

const batchWriteTableSch = z
  .object({
    tableName: z.string().min(1).max(1024),
    keySchema: batchWriteKeySchemaSch,
    operations: z.array(batchWriteOperationSch).min(1).max(25),
  })
  .strict();

export const customBatchWriteCmdInputSch = z
  .object({
    tables: z.array(batchWriteTableSch).min(1).max(25),
    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),
    returnItemCollectionMetrics: returnItemCollectionMetricsOptionsSch.default('NONE'),
  })
  .strict()
  .superRefine(({ tables }, ctx) => {
    validateUniqueTableNames(tables, ctx);

    const totalOperationCount = tables.reduce((count, table) => count + table.operations.length, 0);

    if (totalOperationCount > 25) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A BatchWriteItem request supports at most 25 operations in total.',
        path: ['tables'],
      });
    }
  });

export type CustomBatchWriteCmdInput = z.input<typeof customBatchWriteCmdInputSch>;

// --------------------------------------- Delete command schemas ------------------------------------------------------
const definedExpressionValuesSch = z.record(
  z.string(),
  z.unknown().refine((value) => value !== undefined, {
    message: 'Expression attribute values must not be undefined.',
  })
);

export const customDeleteCmdInputSch = z
  .object({
    tableName: z.string(),
    key: deleteKeySch,
    conditionExpression: z.string().trim().min(1).optional(),
    expressionAttributeNames: stringRecordSch.optional(),
    expressionAttributeValues: definedExpressionValuesSch.optional(),
    returnValues: z.enum(['NONE', 'ALL_OLD']).default('NONE'),
    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),
    returnItemCollectionMetrics: returnItemCollectionMetricsOptionsSch.default('NONE'),
  })
  .strict()
  .superRefine((input, ctx) => {
    const conditionExpression = input.conditionExpression;
    if (!conditionExpression) {
      if (input.expressionAttributeNames) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ExpressionAttributeNames requires a conditionExpression.',
          path: ['expressionAttributeNames'],
        });
      }

      if (input.expressionAttributeValues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ExpressionAttributeValues requires a conditionExpression.',
          path: ['expressionAttributeValues'],
        });
      }

      if (input.returnValuesOnConditionCheckFailure === 'ALL_OLD') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ReturnValuesOnConditionCheckFailure requires a conditionExpression.',
          path: ['returnValuesOnConditionCheckFailure'],
        });
      }

      return;
    }

    const referencedNameTokens = new Set(conditionExpression.match(/#[A-Za-z0-9_]+/g) ?? []);
    const referencedValueTokens = new Set(conditionExpression.match(/:[A-Za-z0-9_]+/g) ?? []);
    const definedNameTokens = new Set(Object.keys(input.expressionAttributeNames ?? {}));
    const definedValueTokens = new Set(Object.keys(input.expressionAttributeValues ?? {}));

    for (const token of referencedNameTokens) {
      if (!definedNameTokens.has(token)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing definition for expression name token "${token}".`,
          path: ['expressionAttributeNames'],
        });
      }
    }

    for (const token of referencedValueTokens) {
      if (!definedValueTokens.has(token)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing definition for expression value token "${token}".`,
          path: ['expressionAttributeValues'],
        });
      }
    }

    for (const token of definedNameTokens) {
      if (!referencedNameTokens.has(token)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unused expression name token "${token}".`,
          path: ['expressionAttributeNames', token],
        });
      }
    }

    for (const token of definedValueTokens) {
      if (!referencedValueTokens.has(token)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unused expression value token "${token}".`,
          path: ['expressionAttributeValues', token],
        });
      }
    }
  });
export type CustomDeleteCmdInput = z.input<typeof customDeleteCmdInputSch>;

// --------------------------------------- Get command schemas ---------------------------------------------------------
const projectionAttributeSch = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^.[\]]+(?:\.[^.[\]]+|\[\d+\])*$/, 'Invalid projection attribute path.');

const getKeyValueSch = z.union([
  z.string().min(1),
  z.number().finite(),
  z.bigint(),
  z.instanceof(Uint8Array).refine((value) => value.length > 0, 'Binary key values must not be empty.'),
]);

const getKeySch = z
  .record(z.string().min(1), getKeyValueSch)
  .refine((key) => Object.keys(key).length >= 1 && Object.keys(key).length <= 2, {
    message: 'Key must contain a partition key and optional sort key.',
  });

export const customGetCmdInputSch = z
  .object({
    tableName: z.string().min(1),
    key: getKeySch,
    attributes: z.array(projectionAttributeSch).min(1).optional(),
    projectionExpression: optStringSch,
    expressionAttributeNames: stringRecordSch.optional(),
    consistentRead: z.boolean().default(false),
    returnConsumedCapacity: returnConsumedCapacityOptionsSch.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.expressionAttributeNames && !input.projectionExpression) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expressionAttributeNames requires projectionExpression.',
        path: ['expressionAttributeNames'],
      });
    }
  });
export type CustomGetCmdInput = z.input<typeof customGetCmdInputSch>;

// --------------------------------------- Put command schemas ---------------------------------------------------------
export const customPutCmdInputSch = z
  .object({
    tableName: trimmedRequiredStringSch,
    item: genericRecordSch,
    conditionExpression: optStringSch,
    expressionAttributeNames: stringRecordSch.optional(),
    expressionAttributeValues: genericRecordSch.optional(),
    returnValues: z.enum(['NONE', 'ALL_OLD']).default('NONE'),
    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),
    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
    returnItemCollectionMetrics: returnItemCollectionMetricsOptionsSch.default('NONE'),
  })
  .strict()
  .superRefine((input, ctx) => validateConditionExpressionMappings(input, ctx));

export type CustomPutCmdInput = z.input<typeof customPutCmdInputSch>;

// --------------------------------------- Query command schemas -------------------------------------------------------
const queryKeyValueSch = z.union([
  z.string().min(1),
  z.number().finite(),
  z.bigint(),
  z.instanceof(Uint8Array).refine((value) => value.length > 0, 'Binary key values must not be empty.'),
]);

const queryPartitionKeysSch = z
  .record(trimmedRequiredStringSch, queryKeyValueSch)
  .superRefine((keys, ctx) => validateQueryKeyRecord(keys, 1, 4, ctx));

const querySortConditionSch = z.union([
  queryKeyValueSch,
  z.object({ eq: queryKeyValueSch }).strict(),
  z.object({ lt: queryKeyValueSch }).strict(),
  z.object({ lte: queryKeyValueSch }).strict(),
  z.object({ gt: queryKeyValueSch }).strict(),
  z.object({ gte: queryKeyValueSch }).strict(),
  z
    .object({ between: z.tuple([queryKeyValueSch, queryKeyValueSch]) })
    .strict()
    .refine(({ between }) => areQueryKeyValuesCompatible(between[0], between[1]), {
      message: 'BETWEEN values must use compatible key types.',
    }),
  z
    .object({ beginsWith: z.union([z.string().min(1), z.instanceof(Uint8Array)]) })
    .strict()
    .refine(({ beginsWith }) => typeof beginsWith === 'string' || beginsWith.length > 0, {
      message: 'beginsWith binary values must not be empty.',
    }),
]);

const querySortKeysSch = z.record(trimmedRequiredStringSch, querySortConditionSch).superRefine((keys, ctx) => {
  validateQueryKeyRecord(keys, 0, 4, ctx);

  const entries = Object.entries(keys);
  const rangeIndex = entries.findIndex(([, condition]) => isQueryRangeCondition(condition));

  if (rangeIndex >= 0 && rangeIndex !== entries.length - 1) {
    ctx.addIssue({
      code: 'custom',
      path: [entries[rangeIndex]?.[0] ?? 'sortKeys'],
      message: 'A non-equality sort-key condition must be the final sort-key entry.',
    });
  }

  if (rangeIndex >= 0 && entries.slice(rangeIndex + 1).some(([, condition]) => isQueryRangeCondition(condition))) {
    ctx.addIssue({
      code: 'custom',
      message: 'Only the final sort key may use a non-equality condition.',
    });
  }
});

export const customQueryCmdInputSch = z
  .object({
    tableName: trimmedRequiredStringSch,
    indexName: trimmedRequiredStringSch.optional(),
    partitionKeys: queryPartitionKeysSch,
    sortKeys: querySortKeysSch.default({}),
    filterExpression: optStringSch,
    projectionExpression: optStringSch,
    expressionAttributeNames: expressionNamesSch.optional(),
    expressionAttributeValues: expressionValuesSch.optional(),
    exclusiveStartKey: z
      .record(z.string().min(1), z.unknown())
      .refine((key) => Object.keys(key).length > 0, 'ExclusiveStartKey must not be empty.')
      .optional(),
    limit: z.number().int().positive().optional(),
    consistentRead: z.boolean().default(false),
    scanIndexForward: z.boolean().default(true),
    select: z.enum(['ALL_ATTRIBUTES', 'ALL_PROJECTED_ATTRIBUTES', 'SPECIFIC_ATTRIBUTES', 'COUNT']).optional(),
    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.projectionExpression && input.select !== undefined && input.select !== 'SPECIFIC_ATTRIBUTES') {
      ctx.addIssue({
        code: 'custom',
        path: ['select'],
        message: 'ProjectionExpression requires Select to be SPECIFIC_ATTRIBUTES or omitted.',
      });
    }

    if (input.select === 'SPECIFIC_ATTRIBUTES' && !input.projectionExpression) {
      ctx.addIssue({
        code: 'custom',
        path: ['projectionExpression'],
        message: 'SPECIFIC_ATTRIBUTES requires projectionExpression.',
      });
    }

    if (input.select === 'ALL_PROJECTED_ATTRIBUTES' && !input.indexName) {
      ctx.addIssue({
        code: 'custom',
        path: ['select'],
        message: 'ALL_PROJECTED_ATTRIBUTES requires indexName.',
      });
    }
  });

export type QueryKeyValue = z.infer<typeof queryKeyValueSch>;
export type QuerySortCondition = z.infer<typeof querySortConditionSch>;
export type CustomQueryCmdInput = z.input<typeof customQueryCmdInputSch>;

function validateQueryKeyRecord(
  keys: Record<string, unknown>,
  minimum: number,
  maximum: number,
  ctx: z.RefinementCtx
): void {
  const names = Object.keys(keys);

  if (names.length < minimum || names.length > maximum) {
    ctx.addIssue({
      code: 'custom',
      message: `Key record must contain between ${minimum} and ${maximum} attributes.`,
    });
  }

  for (const name of names) {
    if (/^(0|[1-9]\d*)$/.test(name)) {
      ctx.addIssue({
        code: 'custom',
        path: [name],
        message: 'Integer-like attribute names are not supported because their object order is unstable.',
      });
    }
  }
}

function isQueryRangeCondition(condition: QuerySortCondition): boolean {
  return (
    typeof condition === 'object' &&
    condition !== null &&
    !(condition instanceof Uint8Array) &&
    !Object.hasOwn(condition, 'eq')
  );
}

function areQueryKeyValuesCompatible(left: QueryKeyValue, right: QueryKeyValue): boolean {
  if (left instanceof Uint8Array || right instanceof Uint8Array) {
    return left instanceof Uint8Array && right instanceof Uint8Array;
  }

  const leftIsNumber = typeof left === 'number' || typeof left === 'bigint';
  const rightIsNumber = typeof right === 'number' || typeof right === 'bigint';

  if (leftIsNumber || rightIsNumber) return leftIsNumber && rightIsNumber;

  return typeof left === typeof right;
}

// --------------------------------------- Scan command schemas --------------------------------------------------------

export const customScanCmdInputSch = z
  .object({
    tableName: trimmedRequiredStringSch,
    indexName: trimmedRequiredStringSch.optional(),
    filterExpression: trimmedRequiredStringSch.optional(),
    projectionExpression: trimmedRequiredStringSch.optional(),
    expressionAttributeNames: expressionNamesSch.optional(),
    expressionAttributeValues: expressionValuesSch.optional(),
    exclusiveStartKey: z
      .record(z.string().min(1), z.unknown())
      .refine((key) => Object.keys(key).length > 0, {
        message: 'ExclusiveStartKey must not be empty.',
      })
      .optional(),
    limit: z.number().int().positive().optional(),
    consistentRead: z.boolean().default(false),
    select: z.enum(['ALL_ATTRIBUTES', 'ALL_PROJECTED_ATTRIBUTES', 'SPECIFIC_ATTRIBUTES', 'COUNT']).optional(),
    segment: z.number().int().min(0).optional(),
    totalSegments: z.number().int().min(1).max(1_000_000).optional(),
    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),
  })
  .strict()
  .superRefine((input, ctx) => {
    // Both properties are required for parallel scans.
    const hasSegment = input.segment !== undefined;
    const hasTotalSegments = input.totalSegments !== undefined;

    if (hasSegment !== hasTotalSegments) {
      ctx.addIssue({
        code: 'custom',
        path: [hasSegment ? 'totalSegments' : 'segment'],
        message: 'Segment and totalSegments must be provided together.',
      });
    }

    if (hasSegment && hasTotalSegments && input.segment! >= input.totalSegments!) {
      ctx.addIssue({
        code: 'custom',
        path: ['segment'],
        message: 'Segment must be less than totalSegments.',
      });
    }

    // ProjectionExpression and Select must be compatible.
    if (input.projectionExpression) {
      if (input.select !== undefined && input.select !== 'SPECIFIC_ATTRIBUTES') {
        ctx.addIssue({
          code: 'custom',
          path: ['select'],
          message: 'ProjectionExpression requires Select to be SPECIFIC_ATTRIBUTES or omitted.',
        });
      }
    }

    if (input.select === 'SPECIFIC_ATTRIBUTES' && !input.projectionExpression) {
      ctx.addIssue({
        code: 'custom',
        path: ['projectionExpression'],
        message: 'SPECIFIC_ATTRIBUTES requires projectionExpression.',
      });
    }

    if (input.select === 'ALL_PROJECTED_ATTRIBUTES' && !input.indexName) {
      ctx.addIssue({
        code: 'custom',
        path: ['select'],
        message: 'ALL_PROJECTED_ATTRIBUTES requires indexName.',
      });
    }
  });

export type CustomScanCmdInput = z.input<typeof customScanCmdInputSch>;

// --------------------------------------- Transact get command schemas ------------------------------------------------
export const customTransactGetItemSch = z
  .object({
    tableName: trimmedRequiredStringSch,

    key: oneOrTwoAttributeRecordSch,

    projectionExpression: optStringSch,

    expressionAttributeNames: stringRecordSch.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.expressionAttributeNames && !input.projectionExpression) {
      ctx.addIssue({
        code: 'custom',
        path: ['expressionAttributeNames'],
        message: 'expressionAttributeNames requires projectionExpression.',
      });
    }
  });

export const customTransactGetCmdInputSch = z
  .object({
    transactItems: z
      .array(customTransactGetItemSch)
      .min(1, 'At least one transact item is required.')
      .max(100, 'A transact get can contain at most 100 items.'),

    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),
  })
  .strict();

export type CustomTransactGetCmdInput = z.input<typeof customTransactGetCmdInputSch>;

// --------------------------------------- Transact write command schemas ----------------------------------------------

const transactWritePutItemSch = z
  .object({
    operation: z.literal('PUT'),

    tableName: trimmedRequiredStringSch,

    item: genericRecordSch,

    conditionExpression: optStringSch,

    expressionAttributeNames: stringRecordSch.optional(),

    expressionAttributeValues: genericRecordSch.optional(),

    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
  })
  .strict()
  .superRefine((input, ctx) => validateConditionExpressionMappings(input, ctx, 'PUT'));

const transactWriteUpdateItemSch = z
  .object({
    operation: z.literal('UPDATE'),

    tableName: trimmedRequiredStringSch,

    key: oneOrTwoAttributeRecordSch,

    updateExpression: z.string().trim().min(1),

    conditionExpression: optStringSch,

    expressionAttributeNames: stringRecordSch.optional(),

    expressionAttributeValues: genericRecordSch.optional(),

    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
  })
  .strict();

const transactWriteDeleteItemSch = z
  .object({
    operation: z.literal('DELETE'),

    tableName: trimmedRequiredStringSch,

    key: oneOrTwoAttributeRecordSch,

    conditionExpression: optStringSch,

    expressionAttributeNames: stringRecordSch.optional(),

    expressionAttributeValues: genericRecordSch.optional(),

    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
  })
  .strict()
  .superRefine((input, ctx) => validateConditionExpressionMappings(input, ctx, 'DELETE'));

const transactWriteConditionCheckItemSch = z
  .object({
    operation: z.literal('CONDITION_CHECK'),

    tableName: trimmedRequiredStringSch,

    key: oneOrTwoAttributeRecordSch,

    conditionExpression: z.string().trim().min(1),

    expressionAttributeNames: stringRecordSch.optional(),

    expressionAttributeValues: genericRecordSch.optional(),

    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
  })
  .strict();

export const customTransactWriteItemSch = z.discriminatedUnion('operation', [
  transactWritePutItemSch,
  transactWriteUpdateItemSch,
  transactWriteDeleteItemSch,
  transactWriteConditionCheckItemSch,
]);

export const customTransactWriteCmdInputSch = z
  .object({
    transactItems: z
      .array(customTransactWriteItemSch)
      .min(1, 'At least one transact write item is required.')
      .max(100, 'A transact write can contain at most 100 operations.'),

    clientRequestToken: z.string().trim().min(1).max(36).optional(),

    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),

    returnItemCollectionMetrics: returnItemCollectionMetricsOptionsSch.default('NONE'),
  })
  .strict();

export type CustomTransactWriteCmdInput = z.input<typeof customTransactWriteCmdInputSch>;
// --------------------------------------- Update command schemas ------------------------------------------------------

const updateRecordSch = z.record(z.string().min(1), z.unknown()).superRefine((record, ctx) => {
  const validate = (value: unknown, path: PropertyKey[], ancestors: Set<object>): void => {
    if (value === undefined) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: 'Undefined cannot be stored as a DynamoDB value.',
      });
      return;
    }

    if (typeof value === 'number' && !Number.isFinite(value)) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: 'DynamoDB numbers must be finite.',
      });
      return;
    }

    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint' ||
      value instanceof Uint8Array
    ) {
      return;
    }

    if (typeof value !== 'object') {
      ctx.addIssue({
        code: 'custom',
        path,
        message: 'Unsupported DynamoDB value type.',
      });
      return;
    }

    if (ancestors.has(value)) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: 'Circular references are not supported.',
      });
      return;
    }

    if (
      !Array.isArray(value) &&
      !(value instanceof Set) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        path,
        message: 'Only plain objects, arrays, and sets are supported.',
      });
      return;
    }

    ancestors.add(value);

    if (value instanceof Set) {
      if (value.size === 0) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'DynamoDB sets must not be empty.',
        });
      }

      for (const entry of value) {
        validate(entry, path, ancestors);
      }

      const entries = [...value];

      const category = (entry: unknown): string => {
        if (typeof entry === 'string') return 'string';
        if (typeof entry === 'number' || typeof entry === 'bigint') {
          return 'number';
        }
        if (entry instanceof Uint8Array) return 'binary';
        return 'unsupported';
      };

      const categories = new Set(entries.map(category));

      if (categories.size !== 1 || categories.has('unsupported')) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'Sets must contain one supported DynamoDB scalar type.',
        });
      }
    } else {
      for (const [key, child] of Object.entries(value)) {
        validate(child, [...path, key], ancestors);
      }
    }

    ancestors.delete(value);
  };

  for (const [key, value] of Object.entries(record)) {
    validate(value, [key], new Set());
  }
});

const updateKeySch = z
  .record(z.string().min(1), z.union([z.string().min(1), z.number().finite(), z.instanceof(Uint8Array)]))
  .refine(
    (key) => {
      const count = Object.keys(key).length;
      return count === 1 || count === 2;
    },
    {
      message: 'Key must contain exactly 1 or 2 attributes.',
    }
  );

export const customUpdateCmdInputSch = z
  .object({
    tableName: trimmedRequiredStringSch,
    key: updateKeySch,
    item: updateRecordSch.optional(),
    updateExpression: trimmedRequiredStringSch.optional(),
    conditionExpression: trimmedRequiredStringSch.optional(),
    expressionAttributeNames: expressionNamesSch.optional(),
    expressionAttributeValues: expressionValuesSch.optional(),
    extraExpAttributeNames: expressionNamesSch.optional(),
    extraExpAttributeValues: expressionValuesSch.optional(),
    returnValues: returnValuesOptionsSch.default('NONE'),
    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),
    returnItemCollectionMetrics: returnItemCollectionMetricsOptionsSch.default('NONE'),
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasItem = input.item !== undefined;
    const hasExpression = input.updateExpression !== undefined;

    if (hasItem === hasExpression) {
      ctx.addIssue({
        code: 'custom',
        path: ['item'],
        message: 'Provide exactly one of item or updateExpression.',
      });
    }

    if (hasItem && Object.keys(input.item ?? {}).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['item'],
        message: 'Item must contain at least one attribute.',
      });
    }

    if (hasItem) {
      for (const attribute of Object.keys(input.item ?? {})) {
        if (Object.hasOwn(input.key, attribute)) {
          ctx.addIssue({
            code: 'custom',
            path: ['item', attribute],
            message: 'Primary-key attributes cannot be updated.',
          });
        }
      }
    }

    for (const [field, values] of [
      ['expressionAttributeValues', input.expressionAttributeValues],
      ['extraExpAttributeValues', input.extraExpAttributeValues],
    ] as const) {
      if (values) {
        const result = updateRecordSch.safeParse(values);

        if (!result.success) {
          for (const issue of result.error.issues) {
            ctx.addIssue({
              code: 'custom',
              path: [field, ...issue.path],
              message: issue.message,
            });
          }
        }
      }
    }
  });

export type CustomUpdateCmdInput = z.input<typeof customUpdateCmdInputSch>;

export type ParsedUpdateCmdInput = z.output<typeof customUpdateCmdInputSch>;
