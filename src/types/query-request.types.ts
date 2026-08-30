import { z } from 'zod';
import {
  dynamoAttrTypeSch,
  dynamoFilterOperatorSch,
  dynamoKeyAttrTypeSch,
  dynamoSortOperatorSch,
  optStringSch,
  type GenericRecord,
} from './utility.types';

export {
  dynamoAttrTypeSch,
  dynamoFilterOperatorSch,
  dynamoKeyAttrTypeSch,
  dynamoSortOperatorSch as dynamoSortKeyOperatorSch,
  optStringSch,
} from './utility.types';
export type {
  DynamoAttrType,
  DynamoFilterOperator,
  DynamoKeyAttrType,
  DynamoSortOperator as DynamoSortKeyOperator,
  GenericRecord,
} from './utility.types';

// --------------------------------------- Shared types and schemas ----------------------------------------------------
const stringBooleanSch = z.preprocess((value) => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;

  return value;
}, z.boolean());

const optIntSch = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) return undefined;
  if (typeof value === 'string' && !/^(0|[1-9]\d*)$/.test(value.trim())) return value;
  return typeof value === 'string' ? Number(value.trim()) : value;
}, z.number().int().optional());

const filterValueSch = z.preprocess(
  (value) => {
    if (value === '' || value === undefined) return undefined;
    return typeof value === 'string' ? value.trim() : value;
  },
  z.union([z.string().min(1), z.null()]).optional()
);

function normalizeNullFilterValues(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const normalized = { ...value } as GenericRecord;
  for (let position = 1; position <= 5; position++) {
    if (
      normalized[`filterAttr${position}ValueType`] === 'NULL' &&
      normalized[`filterAttr${position}Value`] === undefined
    ) {
      normalized[`filterAttr${position}Value`] = null;
    }
  }
  return normalized;
}

const lastEvaluatedKeySch = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'object') {
      return value;
    }

    if (typeof value !== 'string') {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      // Let the Zod record schema produce the validation error.
      return value;
    }
  },
  z
    .record(z.string(), z.union([z.string(), z.number(), z.instanceof(Uint8Array)]).optional())
    .refine((key) => Object.keys(key).length > 0, 'lastEvaluatedKey must contain at least one key.')
    .optional()
);

const readOperationSch = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
  z.enum(['QUERY', 'SCAN'])
);

export const dynamoSortingSch = z.preprocess(
  (value) => {
    if (value === '' || value === null || value === undefined) {
      return undefined;
    }

    return typeof value === 'string' ? value.trim().toUpperCase() : value;
  },
  z.enum(['ASC', 'DESC']).optional()
);
export type DynamoSorting = z.infer<typeof dynamoSortingSch>;

// ------------------------------ Single Query/Scan request schema  ----------------------------------------------------
export const dynamoReadQueryRequestSch = z
  .preprocess(
    normalizeNullFilterValues,
    z
      .object({
        operation: readOperationSch.default('QUERY'),
        // Query target
        table: z.string().trim().min(1),
        index: optStringSch,
        region: optStringSch,
        tab: optStringSch,
        maximize: stringBooleanSch.optional(),

        // Partition-key attributes
        pkAttr1Name: optStringSch,
        pkAttr1Value: optStringSch,
        pkAttr1ValueType: dynamoKeyAttrTypeSch.optional(),

        pkAttr2Name: optStringSch,
        pkAttr2Value: optStringSch,
        pkAttr2ValueType: dynamoKeyAttrTypeSch.optional(),

        pkAttr3Name: optStringSch,
        pkAttr3Value: optStringSch,
        pkAttr3ValueType: dynamoKeyAttrTypeSch.optional(),

        pkAttr4Name: optStringSch,
        pkAttr4Value: optStringSch,
        pkAttr4ValueType: dynamoKeyAttrTypeSch.optional(),

        // Sort-key attributes
        skAttr1Name: optStringSch,
        skAttr1Condition: dynamoSortOperatorSch.optional(),
        skAttr1Value: optStringSch,
        skAttr1Value2: optStringSch,
        skAttr1ValueType: dynamoKeyAttrTypeSch.optional(),

        skAttr2Name: optStringSch,
        skAttr2Condition: dynamoSortOperatorSch.optional(),
        skAttr2Value: optStringSch,
        skAttr2Value2: optStringSch,
        skAttr2ValueType: dynamoKeyAttrTypeSch.optional(),

        skAttr3Name: optStringSch,
        skAttr3Condition: dynamoSortOperatorSch.optional(),
        skAttr3Value: optStringSch,
        skAttr3Value2: optStringSch,
        skAttr3ValueType: dynamoKeyAttrTypeSch.optional(),

        skAttr4Name: optStringSch,
        skAttr4Condition: dynamoSortOperatorSch.optional(),
        skAttr4Value: optStringSch,
        skAttr4Value2: optStringSch,
        skAttr4ValueType: dynamoKeyAttrTypeSch.optional(),

        // Filter attributes
        filterJoin: z.enum(['AND', 'OR']).default('AND'),

        filterAttr1Name: optStringSch,
        filterAttr1Condition: dynamoFilterOperatorSch.optional(),
        filterAttr1ValueType: dynamoAttrTypeSch.optional(),
        filterAttr1Value: filterValueSch,
        filterAttr1Value2: optStringSch,

        filterAttr2Name: optStringSch,
        filterAttr2Condition: dynamoFilterOperatorSch.optional(),
        filterAttr2ValueType: dynamoAttrTypeSch.optional(),
        filterAttr2Value: filterValueSch,
        filterAttr2Value2: optStringSch,

        filterAttr3Name: optStringSch,
        filterAttr3Condition: dynamoFilterOperatorSch.optional(),
        filterAttr3ValueType: dynamoAttrTypeSch.optional(),
        filterAttr3Value: filterValueSch,
        filterAttr3Value2: optStringSch,

        filterAttr4Name: optStringSch,
        filterAttr4Condition: dynamoFilterOperatorSch.optional(),
        filterAttr4ValueType: dynamoAttrTypeSch.optional(),
        filterAttr4Value: filterValueSch,
        filterAttr4Value2: optStringSch,

        filterAttr5Name: optStringSch,
        filterAttr5Condition: dynamoFilterOperatorSch.optional(),
        filterAttr5ValueType: dynamoAttrTypeSch.optional(),
        filterAttr5Value: filterValueSch,
        filterAttr5Value2: optStringSch,

        // Read, pagination and Scan options
        sorting: dynamoSortingSch,
        limit: optIntSch.pipe(z.number().positive().optional()),
        consistentRead: stringBooleanSch.optional(),
        lastEvaluatedKey: lastEvaluatedKeySch,
        segment: optIntSch.pipe(z.number().nonnegative().optional()),
        totalSegments: optIntSch.pipe(z.number().positive().max(1_000_000).optional()),
        projectionExpression: optStringSch,
        expressionAttributeNames: z.record(z.string().min(1), z.string().min(1)).optional(),
        select: z.enum(['ALL_ATTRIBUTES', 'ALL_PROJECTED_ATTRIBUTES', 'SPECIFIC_ATTRIBUTES', 'COUNT']).optional(),
        returnConsumedCapacity: z.enum(['INDEXES', 'TOTAL', 'NONE']).optional(),
      })
      .strict()
  )
  .superRefine((params, ctx) => {
    validateOperationParams(params, ctx);
    validatePartitionKeyParams(params, ctx);
    validateSortKeyParams(params, ctx);
    validateFilterParams(params, ctx);
    validateQueryFilterKeyUsage(params, ctx);
    validateParallelScanParams(params, ctx);
    validateProjectionParams(params, ctx);
  });

export type DynamoReadQueryRequest = z.infer<typeof dynamoReadQueryRequestSch>;

/**
 * Validates rules that depend on whether the request is a QUERY or SCAN.
 *
 * QUERY requests require the first partition-key name and value, while SCAN
 * requests cannot contain key parameters or query-only sorting options.
 *
 * @param params Parsed request values being validated.
 * @param ctx Zod refinement context used to report validation issues.
 */
function validateOperationParams(params: GenericRecord, ctx: z.RefinementCtx): void {
  if (params.operation === 'QUERY') {
    if (!params.pkAttr1Name) {
      addIssue(ctx, 'pkAttr1Name', 'QUERY requires pkAttr1Name.');
    }

    if (!params.pkAttr1Value) {
      addIssue(ctx, 'pkAttr1Value', 'QUERY requires pkAttr1Value.');
    }

    if (params.segment !== undefined || params.totalSegments !== undefined) {
      addIssue(ctx, 'segment', 'segment and totalSegments are only supported by SCAN.');
    }

    return;
  }

  for (let position = 1; position <= 4; position++) {
    const hasPartitionKey = hasAnyDefined(params, [
      `pkAttr${position}Name`,
      `pkAttr${position}Value`,
      `pkAttr${position}ValueType`,
    ]);

    const hasSortKey = hasAnyDefined(params, [
      `skAttr${position}Name`,
      `skAttr${position}Condition`,
      `skAttr${position}Value`,
      `skAttr${position}Value2`,
      `skAttr${position}ValueType`,
    ]);

    if (hasPartitionKey || hasSortKey) {
      addIssue(ctx, 'operation', 'SCAN must not include partition-key or sort-key parameters.');

      break;
    }
  }

  if (params.sorting !== undefined) {
    addIssue(ctx, 'sorting', 'sorting is only supported by QUERY.');
  }
}

/**
 * Validates QUERY partition-key slots and required values.
 *
 * QUERY supports exactly one partition-key equality condition.
 *
 * @param params Parsed request values being validated.
 * @param ctx Zod refinement context used to report validation issues.
 */
function validatePartitionKeyParams(params: GenericRecord, ctx: z.RefinementCtx): void {
  if (params.operation !== 'QUERY') return;

  for (let position = 1; position <= 4; position++) {
    const prefix = `pkAttr${position}`;
    if (!hasAnyDefined(params, [`${prefix}Name`, `${prefix}Value`, `${prefix}ValueType`])) continue;
    if (!params[`${prefix}Name`]) addIssue(ctx, `${prefix}Name`, `Partition key ${position} requires a name.`);
    if (!params[`${prefix}Value`]) addIssue(ctx, `${prefix}Value`, `Partition key ${position} requires a value.`);
  }
}

/**
 * Validates QUERY sort-key slots, operators, and operator-specific values.
 *
 * QUERY supports at most one sort-key condition. BETWEEN may use a second
 * value, while all other operators accept only one value.
 *
 * @param params Parsed request values being validated.
 * @param ctx Zod refinement context used to report validation issues.
 */
function validateSortKeyParams(params: GenericRecord, ctx: z.RefinementCtx): void {
  if (params.operation !== 'QUERY') return;

  for (let position = 1; position <= 4; position++) {
    const prefix = `skAttr${position}`;

    const name = params[`${prefix}Name`];
    const value = params[`${prefix}Value`];
    const value2 = params[`${prefix}Value2`];
    const valueType = params[`${prefix}ValueType`];

    const rawCondition = params[`${prefix}Condition`];

    const condition = rawCondition ?? 'EQUAL_TO';

    const hasAnyField = hasAnyDefined(params, [
      `${prefix}Name`,
      `${prefix}Condition`,
      `${prefix}Value`,
      `${prefix}Value2`,
      `${prefix}ValueType`,
    ]);

    if (!hasAnyField) continue;

    if (!name) {
      addIssue(ctx, `${prefix}Name`, `Sort key ${position} requires a name.`);
    }

    if (!value) {
      addIssue(ctx, `${prefix}Value`, `Sort key ${position} requires a value.`);
    }

    if (condition === 'BETWEEN' && !value2) {
      addIssue(ctx, `${prefix}Value2`, 'BETWEEN requires a second value.');
    }

    if (condition !== 'BETWEEN' && value2 !== undefined) {
      addIssue(ctx, `${prefix}Value2`, 'Only BETWEEN supports a second value.');
    }

    if (condition === 'BEGINS_WITH' && valueType === 'N') {
      addIssue(ctx, `${prefix}ValueType`, 'BEGINS_WITH does not support number values.');
    }
  }
}

/**
 * Validates filter slots, conditions, value requirements, and value types.
 *
 * Filter slots must be continuous. EXISTS and NOT_EXISTS do not accept values,
 * NULL is represented by an explicit native null value, and BETWEEN and BEGINS_WITH have restricted
 * value and type combinations.
 *
 * @param params Parsed request values being validated.
 * @param ctx Zod refinement context used to report validation issues.
 */
function validateFilterParams(params: GenericRecord, ctx: z.RefinementCtx): void {
  let foundEmptySlot = false;

  for (let position = 1; position <= 5; position++) {
    const prefix = `filterAttr${position}`;

    const name = params[`${prefix}Name`];
    const condition = params[`${prefix}Condition`];
    const valueType = params[`${prefix}ValueType`];
    const value = params[`${prefix}Value`];
    const value2 = params[`${prefix}Value2`];

    const hasAnyFilterField = hasAnyDefined(params, [
      `${prefix}Name`,
      `${prefix}Condition`,
      `${prefix}ValueType`,
      `${prefix}Value`,
      `${prefix}Value2`,
    ]);

    if (!hasAnyFilterField) {
      foundEmptySlot = true;
      continue;
    }

    if (foundEmptySlot) {
      addIssue(ctx, `${prefix}Name`, 'Filter slots must be continuous without gaps.');
    }

    if (!name) {
      addIssue(ctx, `${prefix}Name`, `Filter ${position} requires an attribute name.`);
    }

    if (!condition) {
      addIssue(ctx, `${prefix}Condition`, `Filter ${position} requires a condition.`);

      continue;
    }

    const hasNoValueCondition = condition === 'EXISTS' || condition === 'NOT_EXISTS';

    if (hasNoValueCondition) {
      if (value !== undefined || value2 !== undefined) {
        addIssue(ctx, `${prefix}Value`, `${String(condition)} must not include a value.`);
      }

      continue;
    }

    const isNullValue = valueType === 'NULL';

    if (value === undefined && !isNullValue) {
      addIssue(ctx, `${prefix}Value`, `${String(condition)} requires a value.`);
    }

    if (condition === 'BETWEEN') {
      if (!value2) {
        addIssue(ctx, `${prefix}Value2`, 'BETWEEN requires a second value.');
      }

      if (valueType !== undefined && !['S', 'N', 'B'].includes(String(valueType))) {
        addIssue(ctx, `${prefix}ValueType`, 'BETWEEN supports only S, N, or B values.');
      }
    }

    if (condition !== 'BETWEEN' && value2 !== undefined) {
      addIssue(ctx, `${prefix}Value2`, 'Only BETWEEN supports a second value.');
    }

    if (condition === 'BEGINS_WITH' && valueType !== undefined && valueType !== 'S' && valueType !== 'B') {
      addIssue(ctx, `${prefix}ValueType`, 'BEGINS_WITH supports only S or B values.');
    }
  }
}

/**
 * Prevents QUERY filters from targeting partition-key or sort-key attributes.
 *
 * @param params Parsed request values being validated.
 * @param ctx Zod refinement context used to report validation issues.
 */
function validateQueryFilterKeyUsage(params: GenericRecord, ctx: z.RefinementCtx): void {
  if (params.operation !== 'QUERY') return;

  const keyNames = new Set<unknown>();

  for (let position = 1; position <= 4; position++) {
    const partitionName = params[`pkAttr${position}Name`];

    const sortName = params[`skAttr${position}Name`];

    if (partitionName) keyNames.add(partitionName);
    if (sortName) keyNames.add(sortName);
  }

  for (let position = 1; position <= 5; position++) {
    const filterName = params[`filterAttr${position}Name`];

    if (filterName && keyNames.has(filterName)) {
      addIssue(ctx, `filterAttr${position}Name`, 'Query filters cannot target key attributes. Use a key condition.');
    }
  }
}

/**
 * Validates parallel SCAN pagination parameters.
 *
 * Segment and totalSegments must be supplied together, and segment must be
 * smaller than totalSegments.
 *
 * @param params Parsed request values being validated.
 * @param ctx Zod refinement context used to report validation issues.
 */
function validateParallelScanParams(params: GenericRecord, ctx: z.RefinementCtx): void {
  if (params.operation !== 'SCAN') return;

  const hasSegment = params.segment !== undefined;

  const hasTotalSegments = params.totalSegments !== undefined;

  if (hasSegment !== hasTotalSegments) {
    addIssue(ctx, hasSegment ? 'totalSegments' : 'segment', 'segment and totalSegments must be provided together.');

    return;
  }

  if (
    typeof params.segment === 'number' &&
    typeof params.totalSegments === 'number' &&
    params.segment >= params.totalSegments
  ) {
    addIssue(ctx, 'segment', 'segment must be smaller than totalSegments.');
  }
}

function validateProjectionParams(params: GenericRecord, ctx: z.RefinementCtx): void {
  const hasProjection = params.projectionExpression !== undefined;
  const select = params.select;

  if (select === 'SPECIFIC_ATTRIBUTES' && !hasProjection) {
    addIssue(ctx, 'projectionExpression', 'SPECIFIC_ATTRIBUTES requires projectionExpression.');
  }

  if (select === 'ALL_ATTRIBUTES' && hasProjection) {
    addIssue(ctx, 'select', 'ALL_ATTRIBUTES cannot be used with projectionExpression.');
  }

  if (select === 'COUNT' && hasProjection) {
    addIssue(ctx, 'projectionExpression', 'COUNT cannot be used with projectionExpression.');
  }
}

/**
 * Checks whether at least one named request field has been provided.
 *
 * @param params Parsed request values to inspect.
 * @param keys Field names whose presence should be checked.
 * @returns true when at least one field is defined; otherwise false.
 */
function hasAnyDefined(params: GenericRecord, keys: string[]): boolean {
  return keys.some((key) => params[key] !== undefined);
}

/**
 * Adds a custom Zod issue for a request field.
 *
 * @param ctx Zod refinement context receiving the issue.
 * @param path Dot-free request field name associated with the issue.
 * @param message Human-readable explanation of the validation failure.
 */
function addIssue(ctx: z.RefinementCtx, path: string, message: string): void {
  ctx.addIssue({
    code: 'custom',
    path: [path],
    message,
  });
}
