import { z } from 'zod';

// --------------------------------------- General Utility Types --------------------------------------------------------

export const genericRecordSch = z.record(z.string(), z.unknown());
export type GenericRecord = z.infer<typeof genericRecordSch>;

export const stringRecordSch = z.record(z.string(), z.string());
export type StringRecord = z.infer<typeof stringRecordSch>;

export const requiredStringSch = z.string().trim().min(1);
export type RequiredString = z.infer<typeof requiredStringSch>;

export const optStringSch = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  return typeof value === 'string' ? value.trim() : value;
}, z.string().min(1).optional());
export type OptString = z.infer<typeof optStringSch>;

// --------------------------------------- Dynamo Utility Types --------------------------------------------------------

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

export const dynamoOperationSch = z.enum(['QUERY', 'SCAN']);
export type DynamoOperationSch = z.infer<typeof dynamoOperationSch>;

export const returnValuesOptionsSch = z.enum(['ALL_NEW', 'ALL_OLD', 'UPDATED_NEW', 'UPDATED_OLD', 'NONE']);
export type ReturnValuesOptions = z.infer<typeof returnValuesOptionsSch>;

export const returnConsumedCapacityOptionsSch = z.enum(['INDEXES', 'TOTAL', 'NONE']);
export type ReturnConsumedCapacityOptions = z.infer<typeof returnConsumedCapacityOptionsSch>;

export const returnItemCollectionMetricsOptionsSch = z.enum(['SIZE', 'NONE']);
export type ReturnItemCollectionMetricsOptions = z.infer<typeof returnItemCollectionMetricsOptionsSch>;
