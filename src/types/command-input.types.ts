import { dynamoDocumentSch, dynamoValueSch } from './dynamo-value.types';
import { dynamoKeyValueSch, dynamoPrimaryKeySch, dynamoPaginationKeySch } from './key.types';
import { updateOperationsSch, validateUpdateMode } from './update.types';
import type { Condition, ConditionRecord } from './condition.types';
import { conditionSch, conditionRecordSch } from './condition.types';
import { z } from 'zod';
import {
  optStringSch,
  requiredStringSch,
  returnConsumedCapacityOptionsSch,
  returnItemCollectionMetricsOptionsSch,
  returnValuesOptionsSch,
  stringRecordSch,
} from './utility.types';

const trimmedRequiredStringSch = requiredStringSch;
const returnValuesOnConditionCheckFailureSch = z.enum(['NONE', 'ALL_OLD']).default('NONE');
const expressionNameTokenSch = z.string().regex(/^#[A-Za-z0-9_]+$/);
const expressionValueTokenSch = z.string().regex(/^:[A-Za-z0-9_]+$/);
const expressionNamesSch = z.record(expressionNameTokenSch, z.string().min(1));
const expressionValuesSch = z.record(expressionValueTokenSch, dynamoValueSch);

const oneOrTwoAttributeRecordSch = dynamoPrimaryKeySch;

const structuredConditionFields = {
  condition: conditionSch.optional(),
  conditions: conditionRecordSch.optional(),
  conditionJoin: z.enum(['AND', 'OR']).optional(),
};

type StructuredConditionInput = {
  condition?: Condition | undefined;
  conditions?: ConditionRecord | undefined;
  conditionJoin?: 'AND' | 'OR' | undefined;
  conditionExpression?: string | undefined;
};

function validateStructuredCondition(input: StructuredConditionInput, ctx: z.RefinementCtx): void {
  if (
    [input.condition, input.conditions, input.conditionExpression].filter((value) => value !== undefined).length > 1
  ) {
    ctx.addIssue({ code: 'custom', message: 'Use only one of condition, conditions, or conditionExpression.' });
  }
  if (input.conditionJoin !== undefined && input.conditions === undefined) {
    ctx.addIssue({ code: 'custom', path: ['conditionJoin'], message: 'conditionJoin requires conditions.' });
  }
}

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

export const keyValueSch = dynamoKeyValueSch;
export type KeyValue = z.infer<typeof keyValueSch>;
export const deleteKeySch = dynamoPrimaryKeySch;
export type DeleteKey = z.infer<typeof deleteKeySch>;

export const batchGetTableSch = z
  .object({
    tableName: z.string().min(1).max(1024),
    keys: z.array(dynamoPrimaryKeySch).min(1).max(100),
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
    item: dynamoDocumentSch,
  })
  .strict();

const batchDeleteOperationSch = z
  .object({
    operation: z.literal('DELETE'),
    key: dynamoPrimaryKeySch,
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
const definedExpressionValuesSch = dynamoDocumentSch;

export const customDeleteCmdInputSch = z
  .object({
    tableName: z.string(),
    key: deleteKeySch,
    ...structuredConditionFields,
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
    validateStructuredCondition(input, ctx);
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

      if (input.returnValuesOnConditionCheckFailure === 'ALL_OLD' && !input.condition && !input.conditions) {
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

const getKeySch = dynamoPrimaryKeySch;

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
    item: dynamoDocumentSch,
    ...structuredConditionFields,
    conditionExpression: optStringSch,
    expressionAttributeNames: stringRecordSch.optional(),
    expressionAttributeValues: dynamoDocumentSch.optional(),
    returnValues: z.enum(['NONE', 'ALL_OLD']).default('NONE'),
    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),
    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
    returnItemCollectionMetrics: returnItemCollectionMetricsOptionsSch.default('NONE'),
  })
  .strict()
  .superRefine((input, ctx) => {
    validateConditionExpressionMappings(input, ctx);
    validateStructuredCondition(input, ctx);
  });

export type CustomPutCmdInput = z.input<typeof customPutCmdInputSch>;

// --------------------------------------- Query command schemas -------------------------------------------------------
const queryKeyValueSch = dynamoKeyValueSch;

const queryPartitionKeysSch = z
  .record(z.string().min(1), queryKeyValueSch)
  .superRefine((keys, ctx) => validateQueryKeyRecord(keys, 1, 4, ctx));

const querySortConditionSch = z.union([
  queryKeyValueSch,
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

const querySortKeysSch = z.record(z.string().min(1), querySortConditionSch).superRefine((keys, ctx) => {
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

const queryFilterValueSch = dynamoValueSch;
const queryDirectFilterValueSch = z
  .union([
    z.string(),
    z.number().finite(),
    z.bigint(),
    z.boolean(),
    z.null(),
    z.instanceof(Uint8Array),
    z.array(dynamoValueSch),
    z.set(dynamoValueSch).min(1),
  ])
  .superRefine((value, ctx) => {
    const result = dynamoValueSch.safeParse(value);
    if (!result.success)
      for (const issue of result.error.issues)
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
  });

const queryFilterConditionSch = z.union([
  queryDirectFilterValueSch,
  z.object({ eq: queryFilterValueSch }).strict(),
  z.object({ ne: queryFilterValueSch }).strict(),
  z.object({ lt: queryFilterValueSch }).strict(),
  z.object({ lte: queryFilterValueSch }).strict(),
  z.object({ gt: queryFilterValueSch }).strict(),
  z.object({ gte: queryFilterValueSch }).strict(),
  z.object({ between: z.tuple([queryFilterValueSch, queryFilterValueSch]) }).strict(),
  z.object({ beginsWith: z.union([z.string(), z.instanceof(Uint8Array)]) }).strict(),
  z.object({ contains: queryFilterValueSch }).strict(),
  z.object({ notContains: queryFilterValueSch }).strict(),
  z.object({ exists: z.literal(true) }).strict(),
  z.object({ notExists: z.literal(true) }).strict(),
]);

export const customQueryCmdInputSch = z
  .object({
    tableName: trimmedRequiredStringSch,
    indexName: trimmedRequiredStringSch.optional(),
    partitionKeys: queryPartitionKeysSch,
    sortKeys: querySortKeysSch.default({}),
    filters: z.record(z.string().min(1), queryFilterConditionSch).optional(),
    filterJoin: z.enum(['AND', 'OR']).default('AND'),
    attributes: z.array(projectionAttributeSch).min(1).optional(),
    filterExpression: optStringSch,
    projectionExpression: optStringSch,
    expressionAttributeNames: expressionNamesSch.optional(),
    expressionAttributeValues: expressionValuesSch.optional(),
    exclusiveStartKey: dynamoPaginationKeySch.optional(),
    limit: z.number().int().positive().optional(),
    consistentRead: z.boolean().default(false),
    scanIndexForward: z.boolean().default(true),
    select: z.enum(['ALL_ATTRIBUTES', 'ALL_PROJECTED_ATTRIBUTES', 'SPECIFIC_ATTRIBUTES', 'COUNT']).optional(),
    returnConsumedCapacity: returnConsumedCapacityOptionsSch.default('NONE'),
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasProjection = input.projectionExpression !== undefined || input.attributes !== undefined;

    if (hasProjection && input.select !== undefined && input.select !== 'SPECIFIC_ATTRIBUTES') {
      ctx.addIssue({
        code: 'custom',
        path: ['select'],
        message: 'ProjectionExpression requires Select to be SPECIFIC_ATTRIBUTES or omitted.',
      });
    }

    if (input.select === 'SPECIFIC_ATTRIBUTES' && !hasProjection) {
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
export type QueryFilterCondition = z.infer<typeof queryFilterConditionSch>;
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
  return typeof condition === 'object' && condition !== null && !(condition instanceof Uint8Array);
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
    exclusiveStartKey: dynamoPaginationKeySch.optional(),
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
    item: dynamoDocumentSch,
    ...structuredConditionFields,
    conditionExpression: optStringSch,
    expressionAttributeNames: stringRecordSch.optional(),
    expressionAttributeValues: dynamoDocumentSch.optional(),
    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
  })
  .strict()
  .superRefine((input, ctx) => {
    validateStructuredCondition(input, ctx);
    validateConditionExpressionMappings(input, ctx, 'PUT');
  });

const transactWriteUpdateItemSch = z
  .object({
    operation: z.literal('UPDATE'),
    tableName: trimmedRequiredStringSch,
    key: oneOrTwoAttributeRecordSch,
    updates: updateOperationsSch.optional(),
    updateExpression: z.string().trim().min(1).optional(),
    ...structuredConditionFields,
    conditionExpression: optStringSch,
    expressionAttributeNames: stringRecordSch.optional(),
    expressionAttributeValues: dynamoDocumentSch.optional(),
    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
  })
  .strict()
  .superRefine((input, ctx) => {
    validateStructuredCondition(input, ctx);
    validateUpdateMode(input, ctx);
  });

const transactWriteDeleteItemSch = z
  .object({
    operation: z.literal('DELETE'),
    tableName: trimmedRequiredStringSch,
    key: oneOrTwoAttributeRecordSch,
    ...structuredConditionFields,
    conditionExpression: optStringSch,
    expressionAttributeNames: stringRecordSch.optional(),
    expressionAttributeValues: dynamoDocumentSch.optional(),
    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
  })
  .strict()
  .superRefine((input, ctx) => {
    validateStructuredCondition(input, ctx);
    validateConditionExpressionMappings(input, ctx, 'DELETE');
  });

const transactWriteConditionCheckItemSch = z
  .object({
    operation: z.literal('CONDITION_CHECK'),
    tableName: trimmedRequiredStringSch,
    key: oneOrTwoAttributeRecordSch,
    ...structuredConditionFields,
    conditionExpression: z.string().trim().min(1).optional(),
    expressionAttributeNames: stringRecordSch.optional(),
    expressionAttributeValues: dynamoDocumentSch.optional(),
    returnValuesOnConditionCheckFailure: returnValuesOnConditionCheckFailureSch,
  })
  .strict()
  .superRefine((input, ctx) => {
    validateStructuredCondition(input, ctx);
    validateConditionExpressionMappings(input, ctx);
    if (!input.conditionExpression && !input.condition && !input.conditions) {
      ctx.addIssue({ code: 'custom', path: ['condition'], message: 'ConditionCheck requires a condition.' });
    }
  });

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

const updateRecordSch = dynamoDocumentSch;
const updateKeySch = dynamoPrimaryKeySch;

export const customUpdateCmdInputSch = z
  .object({
    tableName: trimmedRequiredStringSch,
    key: updateKeySch,
    item: updateRecordSch.optional(),
    updates: updateOperationsSch.optional(),
    updateExpression: trimmedRequiredStringSch.optional(),
    ...structuredConditionFields,
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
    validateStructuredCondition(input, ctx);
    const hasItem = input.item !== undefined;
    validateUpdateMode(input, ctx);

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
  });

export type CustomUpdateCmdInput = z.input<typeof customUpdateCmdInputSch>;

export type ParsedUpdateCmdInput = z.output<typeof customUpdateCmdInputSch>;
