import { z } from 'zod';
import { dynamoReadPropsSch } from './command.types';
import {
  genericRecordSch,
  optStringSch,
  returnConsumedCapacityOptionsSch,
  returnItemCollectionMetricsOptionsSch,
  stringRecordSch,
} from './utility.types';

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

    returnConsumedCapacity: z.enum(['NONE', 'TOTAL', 'INDEXES']).default('NONE'),
  })
  .strict()
  .superRefine(({ tables }, ctx) => {
    const tableNames = new Set<string>();
    let totalKeyCount = 0;

    tables.forEach((table, index) => {
      totalKeyCount += table.keys.length;

      if (tableNames.has(table.tableName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate table "${table.tableName}" is not allowed.`,
          path: ['tables', index, 'tableName'],
        });
      }

      tableNames.add(table.tableName);
    });

    if (totalKeyCount > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A BatchGetItem request supports at most 100 keys in total.',
        path: ['tables'],
      });
    }
  });

export type CustomBatchGetCmdInput = z.infer<typeof customBatchGetCmdInputSch>;

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
    returnConsumedCapacity: z.enum(['NONE', 'TOTAL', 'INDEXES']).default('NONE'),
    returnItemCollectionMetrics: z.enum(['NONE', 'SIZE']).default('NONE'),
  })
  .strict()
  .superRefine(({ tables }, ctx) => {
    const tableNames = new Set<string>();
    let totalOperationCount = 0;

    tables.forEach((table, index) => {
      totalOperationCount += table.operations.length;

      if (tableNames.has(table.tableName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate table "${table.tableName}" is not allowed.`,
          path: ['tables', index, 'tableName'],
        });
      }

      tableNames.add(table.tableName);
    });

    if (totalOperationCount > 25) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A BatchWriteItem request supports at most 25 operations in total.',
        path: ['tables'],
      });
    }
  });

export type CustomBatchWriteCmdInput = z.infer<typeof customBatchWriteCmdInputSch>;

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
    returnValuesOnConditionCheckFailure: z.enum(['NONE', 'ALL_OLD']).default('NONE'),
    returnConsumedCapacity: z.enum(['NONE', 'TOTAL', 'INDEXES']).default('NONE'),
    returnItemCollectionMetrics: z.enum(['NONE', 'SIZE']).default('NONE'),
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
export type CustomDeleteCmdInput = z.infer<typeof customDeleteCmdInputSch>;

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
export type CustomGetCmdInput = z.infer<typeof customGetCmdInputSch>;

// --------------------------------------- Put command schemas ---------------------------------------------------------
export const customPutCmdInputSch = z
  .object({
    tableName: z.string().trim().min(1),
    item: genericRecordSch,
    conditionExpression: optStringSch,
    expressionAttributeNames: stringRecordSch.optional(),
    expressionAttributeValues: genericRecordSch.optional(),
    returnValues: z.enum(['NONE', 'ALL_OLD']).default('NONE'),
    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),
    returnItemCollectionMetrics: returnItemCollectionMetricsOptionsSch.default('NONE'),
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasCondition = Boolean(input.conditionExpression);

    if (!hasCondition && input.expressionAttributeNames) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expressionAttributeNames'],
        message: 'expressionAttributeNames requires conditionExpression.',
      });
    }

    if (!hasCondition && input.expressionAttributeValues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expressionAttributeValues'],
        message: 'expressionAttributeValues requires conditionExpression.',
      });
    }
  });

export type CustomPutCmdInput = z.infer<typeof customPutCmdInputSch>;

// --------------------------------------- Query command schemas -------------------------------------------------------
export const customQueryCmdInputSch = z.object({
  tableName: z.string(),
  queryCommand: dynamoReadPropsSch,
  keyConditionExpression: optStringSch,
  filterExpression: optStringSch,
  expressionAttributeNames: stringRecordSch.optional(),
  expressionAttributeValues: genericRecordSch.optional(),
  extraExpAttributeNames: stringRecordSch.optional(),
  extraExpAttributeValues: genericRecordSch.optional(),
  projectionExpression: optStringSch,
  scanIndexForward: z.boolean().optional(),
  returnConsumedCapacity: returnConsumedCapacityOptionsSch.optional(),
  returnItemCollectionMetrics: returnItemCollectionMetricsOptionsSch.optional(),
});
export type CustomQueryCmdInput = z.infer<typeof customQueryCmdInputSch>;

// --------------------------------------- Scan command schemas --------------------------------------------------------
export const customScanCmdInputSch = z.object({
  tableName: z.string(),

  scanCommand: dynamoReadPropsSch,

  filterExpression: optStringSch,
  projectionExpression: optStringSch,

  expressionAttributeNames: stringRecordSch.optional(),
  expressionAttributeValues: genericRecordSch.optional(),
  extraExpAttributeNames: stringRecordSch.optional(),
  extraExpAttributeValues: genericRecordSch.optional(),
  returnConsumedCapacity: returnConsumedCapacityOptionsSch.optional(),
  returnItemCollectionMetrics: returnItemCollectionMetricsOptionsSch.optional(),
});
export type CustomScanCmdInput = z.infer<typeof customScanCmdInputSch>;

// --------------------------------------- Transact get command schemas ------------------------------------------------
// --------------------------------------- Transact get command schemas ------------------------------------------------
export const customTransactGetItemSch = z
  .object({
    tableName: z.string().trim().min(1),

    key: genericRecordSch.refine(
      (key) => {
        const keyCount = Object.keys(key).length;

        return keyCount === 1 || keyCount === 2;
      },
      {
        message: 'Key must contain exactly 1 or 2 attributes.',
      }
    ),

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
// --------------------------------------- Transact write command schemas ------------------------------------------------

const returnValuesOnConditionCheckFailureSch = z.enum(['NONE', 'ALL_OLD']).default('NONE');

const transactWritePutItemSch = z
  .object({
    operation: z.literal('PUT'),

    tableName: z.string().trim().min(1),

    item: genericRecordSch,

    conditionExpression: optStringSch,

    expressionAttributeNames: stringRecordSch.optional(),

    expressionAttributeValues: genericRecordSch.optional(),

    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.expressionAttributeNames && !input.conditionExpression) {
      ctx.addIssue({
        code: 'custom',
        path: ['expressionAttributeNames'],
        message: 'expressionAttributeNames requires conditionExpression for a PUT operation.',
      });
    }

    if (input.expressionAttributeValues && !input.conditionExpression) {
      ctx.addIssue({
        code: 'custom',
        path: ['expressionAttributeValues'],
        message: 'expressionAttributeValues requires conditionExpression for a PUT operation.',
      });
    }
  });

const transactWriteUpdateItemSch = z
  .object({
    operation: z.literal('UPDATE'),

    tableName: z.string().trim().min(1),

    key: genericRecordSch.refine(
      (key) => {
        const keyCount = Object.keys(key).length;

        return keyCount === 1 || keyCount === 2;
      },
      {
        message: 'Key must contain exactly 1 or 2 attributes.',
      }
    ),

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

    tableName: z.string().trim().min(1),

    key: genericRecordSch.refine(
      (key) => {
        const keyCount = Object.keys(key).length;

        return keyCount === 1 || keyCount === 2;
      },
      {
        message: 'Key must contain exactly 1 or 2 attributes.',
      }
    ),

    conditionExpression: optStringSch,

    expressionAttributeNames: stringRecordSch.optional(),

    expressionAttributeValues: genericRecordSch.optional(),

    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.expressionAttributeNames && !input.conditionExpression) {
      ctx.addIssue({
        code: 'custom',
        path: ['expressionAttributeNames'],
        message: 'expressionAttributeNames requires conditionExpression for a DELETE operation.',
      });
    }

    if (input.expressionAttributeValues && !input.conditionExpression) {
      ctx.addIssue({
        code: 'custom',
        path: ['expressionAttributeValues'],
        message: 'expressionAttributeValues requires conditionExpression for a DELETE operation.',
      });
    }
  });

const transactWriteConditionCheckItemSch = z
  .object({
    operation: z.literal('CONDITION_CHECK'),

    tableName: z.string().trim().min(1),

    key: genericRecordSch.refine(
      (key) => {
        const keyCount = Object.keys(key).length;

        return keyCount === 1 || keyCount === 2;
      },
      {
        message: 'Key must contain exactly 1 or 2 attributes.',
      }
    ),

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

// --------------------------------------- Update command schemas ------------------------------------------------
const updateNativeValueSch = z.unknown();

const updateRecordSch = z.record(z.string().min(1), updateNativeValueSch).superRefine((record, ctx) => {
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

const updateNameTokenSch = z.string().regex(/^#[A-Za-z0-9_]+$/);
const updateValueTokenSch = z.string().regex(/^:[A-Za-z0-9_]+$/);

const updateExpressionNamesSch = z.record(updateNameTokenSch, z.string().min(1));
const updateExpressionValuesSch = z.record(updateValueTokenSch, z.unknown());

export const customUpdateCmdInputSch = z
  .object({
    tableName: z.string().trim().min(1),
    key: updateKeySch,
    item: updateRecordSch.optional(),
    updateExpression: z.string().trim().min(1).optional(),
    conditionExpression: z.string().trim().min(1).optional(),
    expressionAttributeNames: updateExpressionNamesSch.optional(),
    expressionAttributeValues: updateExpressionValuesSch.optional(),
    extraExpAttributeNames: updateExpressionNamesSch.optional(),
    extraExpAttributeValues: updateExpressionValuesSch.optional(),
    returnValues: z.enum(['NONE', 'ALL_OLD', 'UPDATED_OLD', 'ALL_NEW', 'UPDATED_NEW']).default('NONE'),
    returnValuesOnConditionCheckFailure: z.enum(['NONE', 'ALL_OLD']).default('NONE'),
    returnConsumedCapacity: z.enum(['NONE', 'TOTAL', 'INDEXES']).default('NONE'),
    returnItemCollectionMetrics: z.enum(['NONE', 'SIZE']).default('NONE'),
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
