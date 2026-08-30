import { z } from 'zod';
import {
  dynamoFilterOperatorSch,
  dynamoKeyAttrTypeSch,
  dynamoSortOperatorSch,
  optStringSch,
  requiredStringSch,
} from './utility.types';

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

// ------------------------------------------- Common Read Properties ----------------------------------------------------------

export const dynamoCommandReadProps = {
  table: requiredStringSch,
  index: optStringSch,
  region: optStringSch.default(`ap-southeast-1`),
  filters: z.array(dynamoFilterSch).max(5).default([]),
  filterJoin: z.enum(['AND', 'OR']).default('AND'),
  limit: z.coerce.number().int().positive().optional(),
  lastEvaluatedKey: z.record(z.string(), z.unknown()).optional(),
};

export const dynamoQueryPropsSch = z
  .object({
    ...dynamoCommandReadProps,
    operation: z.literal('QUERY'),
    partitionKeys: z.array(dynamoPartitionKeySch).min(1).max(4),
    sortKeys: z.array(dynamoSortKeySch).max(4).default([]),
    sorting: z.enum(['ASC', 'DESC']).default('ASC'),
  })
  .strict();
export type DynamoQueryRequest = z.infer<typeof dynamoQueryPropsSch>;

export const dynamoScanPropsSch = z
  .object({
    ...dynamoCommandReadProps,
    operation: z.literal('SCAN'),
    segment: z.coerce.number().int().nonnegative().optional(),
    totalSegments: z.coerce.number().int().positive().max(1_000_000).optional(),
  })
  .strict();
export type DynamoScanRequest = z.infer<typeof dynamoScanPropsSch>;
/**
 * Validates the discriminated query or scan request and its cross-field rules.
 */
export const dynamoReadPropsSch = z
  .discriminatedUnion('operation', [dynamoQueryPropsSch, dynamoScanPropsSch])
  .superRefine((request, ctx) => {
    validatePositions(request.filters, 'filters', ctx);

    if (request.operation === 'SCAN') {
      validateParallelScanParams(request, ctx);
      return;
    }

    validateQueryKeyPositions(request, ctx);
    validateQuerySortKeyConditions(request, ctx);
    validateQueryFilterKeyUsage(request, ctx);
  });

export type DynamoReadProps = z.infer<typeof dynamoReadPropsSch>;

// ---------------------------------------- Utility functions ----------------------------------------------------------

/**
 * Validates that positioned values are continuous and start at position one.
 *
 * @param values Positioned request values to validate.
 * @param path Request field path used when reporting issues.
 * @param ctx Zod refinement context that receives validation issues.
 */
export function validatePositions(values: Array<{ position: number }>, path: string, ctx: z.RefinementCtx): void {
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

/**
 * Validates that parallel scan parameters are supplied together and that the
 * segment falls within the configured total segment range.
 *
 * @param request Parsed scan request to validate.
 * @param ctx Zod refinement context that receives validation issues.
 */
export function validateParallelScanParams(request: DynamoScanRequest, ctx: z.RefinementCtx): void {
  const hasSegment = request.segment !== undefined;
  const hasTotalSegments = request.totalSegments !== undefined;

  if (hasSegment !== hasTotalSegments) {
    ctx.addIssue({
      code: 'custom',
      path: hasSegment ? ['totalSegments'] : ['segment'],
      message: 'segment and totalSegments must be provided together.',
    });
    return;
  }

  if (
    typeof request.segment === 'number' &&
    typeof request.totalSegments === 'number' &&
    request.segment >= request.totalSegments
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['segment'],
      message: 'segment must be smaller than totalSegments.',
    });
  }
}

/**
 * Validates the contiguous positions of query partition and sort keys.
 *
 * @param request Parsed query request to validate.
 * @param ctx Zod refinement context that receives validation issues.
 */
export function validateQueryKeyPositions(request: DynamoQueryRequest, ctx: z.RefinementCtx): void {
  validatePositions(request.partitionKeys, 'partitionKeys', ctx);
  validatePositions(request.sortKeys, 'sortKeys', ctx);
}

/**
 * Ensures that a non-equality sort-key condition is the final key condition.
 *
 * @param request Parsed query request to validate.
 * @param ctx Zod refinement context that receives validation issues.
 */
export function validateQuerySortKeyConditions(request: DynamoQueryRequest, ctx: z.RefinementCtx): void {
  const inequalityIndex = request.sortKeys.findIndex((sortKey) => sortKey.condition !== 'EQUAL_TO');

  if (inequalityIndex >= 0 && inequalityIndex !== request.sortKeys.length - 1) {
    ctx.addIssue({
      code: 'custom',
      path: ['sortKeys', inequalityIndex, 'condition'],
      message: 'A non-equality sort-key condition must be the final sort-key condition.',
    });
  }
}

/**
 * Prevents query filters from duplicating partition or sort key conditions.
 *
 * @param request Parsed query request to validate.
 * @param ctx Zod refinement context that receives validation issues.
 */
export function validateQueryFilterKeyUsage(request: DynamoQueryRequest, ctx: z.RefinementCtx): void {
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
}
