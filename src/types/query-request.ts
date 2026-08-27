import { z } from 'zod';
import { optStringSch, requiredStringSch } from './utility';

// ---------------------------------------------------------------------------------------------------------------------
export const dynamoAttrTypeSch = z.enum(['S', 'N', 'B', 'BOOL', 'NULL', 'SS', 'NS', 'BS', 'M', 'L']);
export type DynamoAttrType = z.infer<typeof dynamoAttrTypeSch>;

export const dynamoKeyAttrTypeSch = z.enum(['S', 'N', 'B']);
export type DynamoKeyAttrType = z.infer<typeof dynamoKeyAttrTypeSch>;

export const dynamoSortOperatorSch = z.enum([
  'EQUAL_TO',
  'LESS_THAN',
  'LESS_THAN_OR_EQUAL_TO',
  'GREATER_THAN',
  'GREATER_THAN_OR_EQUAL_TO',
  'BETWEEN',
  'BEGINS_WITH',
]);
export type DynamoSortOperator = z.infer<typeof dynamoSortOperatorSch>;

export const dynamoFilterOperatorSch = z.enum([
  'EQUAL_TO',
  'NOT_EQUAL_TO',
  'LESS_THAN',
  'LESS_THAN_OR_EQUAL_TO',
  'GREATER_THAN',
  'GREATER_THAN_OR_EQUAL_TO',
  'BETWEEN',
  'BEGINS_WITH',
  'CONTAINS',
  'NOT_CONTAINS',
  'EXISTS',
  'NOT_EXISTS',
]);
export type DynamoFilterOperator = z.infer<typeof dynamoFilterOperatorSch>;

// --------------------------------------- Dynamo fields schemas -------------------------------------------------------
export const dynamoPartitionKeySch = z
  .object({
    position: z.number().int().min(1).max(4),
    name: requiredStringSch,
    value: requiredStringSch,
    valueType: dynamoKeyAttrTypeSch.default('S'),
  })
  .strict();

export const dynamoSortKeySch = z
  .object({
    position: z.number().int().min(1).max(4),
    name: requiredStringSch,
    value: requiredStringSch,
    value2: optStringSch,
    valueType: dynamoKeyAttrTypeSch.default('S'),
    condition: dynamoSortOperatorSch.default('EQUAL_TO'),
  })
  .strict()
  .superRefine((sortKey, ctx) => {
    if (sortKey.condition === 'BETWEEN' && !sortKey.value2) {
      ctx.addIssue({
        code: 'custom',
        path: ['value2'],
        message: 'BETWEEN requires value2.',
      });
    }
    if (sortKey.condition !== 'BETWEEN' && sortKey.value2) {
      ctx.addIssue({
        code: 'custom',
        path: ['value2'],
        message: 'value2 is only supported by BETWEEN.',
      });
    }
    if (sortKey.condition === 'BEGINS_WITH' && sortKey.valueType === 'N') {
      ctx.addIssue({
        code: 'custom',
        path: ['valueType'],
        message: 'BEGINS_WITH does not support number values.',
      });
    }
  });

export const dynamoFilterSch = z
  .object({
    position: z.number().int().min(1).max(5),
    name: requiredStringSch,
    value: optStringSch,
    value2: optStringSch,
    valueType: z.enum(['S', 'N', 'B', 'BOOL', 'NULL', 'SS', 'NS', 'BS', 'M', 'L']).default('S'),
    condition: dynamoFilterOperatorSch.default('EQUAL_TO'),
  })
  .strict()
  .superRefine((filter, ctx) => {
    const requiresNoValue = ['EXISTS', 'NOT_EXISTS'].includes(filter.condition);

    if (requiresNoValue) {
      if (filter.value || filter.value2) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: `${filter.condition} must not have a value.`,
        });
      }

      return;
    }

    if (!filter.value) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: `${filter.condition} requires a value.`,
      });
    }

    if (filter.condition === 'BETWEEN' && !filter.value2) {
      ctx.addIssue({
        code: 'custom',
        path: ['value2'],
        message: 'BETWEEN requires value2.',
      });
    }

    if (filter.condition !== 'BETWEEN' && filter.value2) {
      ctx.addIssue({
        code: 'custom',
        path: ['value2'],
        message: 'value2 is only supported by BETWEEN.',
      });
    }
  });

// ---------------------------------------------------------------------------------------------------------------------

export const commonReadProperties = {
  table: requiredStringSch,
  index: optStringSch,
  region: optStringSch.default(`ap-southeast-1`),
  filters: z.array(dynamoFilterSch).max(5).default([]),
  filterJoin: z.enum(['AND', 'OR']).default('AND'),
  limit: z.coerce.number().int().positive().optional(),
  lastEvaluatedKey: z.record(z.string(), z.unknown()).optional(),
};

export const dynamoQueryRequestSch = z
  .object({
    ...commonReadProperties,
    operation: z.literal('QUERY'),
    partitionKeys: z.array(dynamoPartitionKeySch).min(1).max(4),
    sortKeys: z.array(dynamoSortKeySch).max(4).default([]),
    sorting: z.enum(['ASC', 'DESC']).default('ASC'),
  })
  .strict();
export type DynamoQueryRequest = z.infer<typeof dynamoQueryRequestSch>;

export const dynamoScanRequestSch = z
  .object({
    ...commonReadProperties,
    operation: z.literal('SCAN'),
    segment: z.coerce.number().int().nonnegative().optional(),
    totalSegments: z.coerce.number().int().positive().optional(),
  })
  .strict();
export type DynamoScanRequest = z.infer<typeof dynamoScanRequestSch>;
/**
 *
 */
export const dynamoReadRequestSch = z
  .discriminatedUnion('operation', [dynamoQueryRequestSch, dynamoScanRequestSch])
  .superRefine((request, ctx) => {
    validatePositions(request.filters, 'filters', ctx);

    if (request.operation === 'SCAN') {
      const hasSegment = request.segment !== undefined;
      const hasTotalSegments = request.totalSegments !== undefined;

      if (hasSegment !== hasTotalSegments) {
        ctx.addIssue({
          code: 'custom',
          path: hasSegment ? ['totalSegments'] : ['segment'],
          message: 'segment and totalSegments must be provided together.',
        });
      }

      return;
    }

    validatePositions(request.partitionKeys, 'partitionKeys', ctx);
    validatePositions(request.sortKeys, 'sortKeys', ctx);

    const inequalityIndex = request.sortKeys.findIndex((sortKey) => sortKey.condition !== 'EQUAL_TO');

    if (inequalityIndex >= 0 && inequalityIndex !== request.sortKeys.length - 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['sortKeys', inequalityIndex, 'condition'],
        message: 'A non-equality sort-key condition must be the final sort-key condition.',
      });
    }

    const keyNames = new Set([
      ...request.partitionKeys.map((key) => key.name),
      ...request.sortKeys.map((key) => key.name),
    ]);

    request.filters.forEach((filter, index) => {
      if (keyNames.has(filter.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['filters', index, 'name'],
          message: 'Query filters cannot target key attributes. Use a key condition.',
        });
      }
    });
  });

export type DynamoReadRequest = z.infer<typeof dynamoReadRequestSch>;

/**
 *
 * @param values
 * @param path
 * @param ctx
 */
function validatePositions(values: Array<{ position: number }>, path: string, ctx: z.RefinementCtx): void {
  values.forEach((value, index) => {
    const expectedPosition = index + 1;

    if (value.position !== expectedPosition) {
      ctx.addIssue({
        code: 'custom',
        path: [path, index, 'position'],
        message: `${path} positions must be continuous and start at 1.`,
      });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------

export const dynamoCommandQuerySch = z.object({
  operation: z.enum(['query', 'scan']).default('query'),

  // Query attributes
  index: z.string().optional(),
  pkAttr1Name: z.string(),
  pkAttr1Value: z.string(),
  pkAttr1ValueType: dynamoKeyAttrTypeSch.default('S'),
  pkAttr2Name: z.string().optional(),
  pkAttr2Value: z.string().optional(),
  pkAttr2ValueType: dynamoKeyAttrTypeSch.optional(),
  pkAttr3Name: z.string().optional(),
  pkAttr3Value: z.string().optional(),
  pkAttr3ValueType: dynamoKeyAttrTypeSch.optional(),
  pkAttr4Name: z.string().optional(),
  pkAttr4Value: z.string().optional(),
  pkAttr4ValueType: dynamoKeyAttrTypeSch.optional(),
  skAttr1Name: z.string().optional(),
  skAttr1Value: z.string().optional(),
  skAttr1ValueType: dynamoKeyAttrTypeSch.optional(),
  skAttr2Name: z.string().optional(),
  skAttr2Value: z.string().optional(),
  skAttr2ValueType: dynamoKeyAttrTypeSch.optional(),
  skAttr3Name: z.string().optional(),
  skAttr3Value: z.string().optional(),
  skAttr3ValueType: dynamoKeyAttrTypeSch.optional(),
  skAttr4Name: z.string().optional(),
  skAttr4Value: z.string().optional(),
  skAttr4ValueType: dynamoKeyAttrTypeSch.optional(),

  // Filter attributes

  // Additional attributes can be added as needed
  table: z.string().optional(),
  tab: z.string().optional(),
  region: z.string().optional(),
});

export type DynamoCommandQuery = z.infer<typeof dynamoCommandQuerySch>;
