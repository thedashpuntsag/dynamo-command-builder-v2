import { z } from 'zod';
import { dynamoReadPropsSch } from './command.types';
import {
  genericRecordSch,
  optStringSch,
  returnConsumedCapacityOptionsSch,
  returnItemCollectionMetricsOptionsSch,
  returnValuesOptionsSch,
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
export const customDeleteCmdInputSch = z
  .object({
    tableName: z.string(),
    key: deleteKeySch,
    conditionExpression: z.string().trim().min(1).optional(),
    expressionAttributeNames: stringRecordSch.optional(),
    expressionAttributeValues: genericRecordSch.optional(),
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
export const customGetCmdInputSch = z.object({
  tableName: z.string(),
  key: genericRecordSch,
  projectionExpression: optStringSch,
  expressionAttributeNames: stringRecordSch.optional(),
  consistentRead: z.boolean().optional(),
  returnConsumedCapacity: returnConsumedCapacityOptionsSch.optional(),
});
export type CustomGetCmdInput = z.infer<typeof customGetCmdInputSch>;

// --------------------------------------- Put command schemas ---------------------------------------------------------
export const customPutCmdInputSch = z.object({
  tableName: z.string(),
  item: genericRecordSch,
  conditionExpression: optStringSch,
  expressionAttributeNames: stringRecordSch.optional(),
  expressionAttributeValues: genericRecordSch.optional(),
  returnValues: returnValuesOptionsSch.optional(),
  returnConsumedCapacity: returnConsumedCapacityOptionsSch.optional(),
  returnItemCollectionMetrics: returnItemCollectionMetricsOptionsSch.optional(),
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
export const customTransactGetCmdInputSch = z.object({});
export type CustomTransactGetCmdInput = z.infer<typeof customTransactGetCmdInputSch>;

// --------------------------------------- Transact write command schemas ----------------------------------------------
export const customTransactWriteCmdInputSch = z.object({});
export type CustomTransactWriteCmdInput = z.infer<typeof customTransactWriteCmdInputSch>;

// --------------------------------------- Update command schemas ------------------------------------------------------
export const customUpdateCmdInputSch = z.object({
  tableName: z.string(),
  key: genericRecordSch,
  item: genericRecordSch.optional(),

  updateExpression: optStringSch,
  conditionExpression: optStringSch,

  expressionAttributeNames: stringRecordSch.optional(),
  expressionAttributeValues: genericRecordSch.optional(),
  extraExpAttributeNames: stringRecordSch.optional(),
  extraExpAttributeValues: genericRecordSch.optional(),

  returnValues: returnValuesOptionsSch.optional(),
  returnConsumedCapacity: returnConsumedCapacityOptionsSch.optional(),
  returnItemCollectionMetrics: returnItemCollectionMetricsOptionsSch.optional(),
});
export type CustomUpdateCmdInput = z.infer<typeof customUpdateCmdInputSch>;
