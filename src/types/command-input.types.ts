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
export const customBatchGetCmdInputSch = z.object({
  tableName: z.string(),
  requestItems: genericRecordSch,
  returnConsumedCapacity: returnConsumedCapacityOptionsSch.optional(),
});
export type CustomBatchGetCmdInput = z.infer<typeof customBatchGetCmdInputSch>;

// --------------------------------------- Batch write command schemas -------------------------------------------------
export const customBatchWriteCmdInputSch = z.object({
  tableName: z.string(),
  requestItems: genericRecordSch,
  returnConsumedCapacity: returnConsumedCapacityOptionsSch.optional(),
});
export type CustomBatchWriteCmdInput = z.infer<typeof customBatchWriteCmdInputSch>;

// --------------------------------------- Delete command schemas ------------------------------------------------------
export const customDeleteCmdInputSch = z.object({
  tableName: z.string(),
  key: genericRecordSch,
  conditionExpression: optStringSch,
  expressionAttributeNames: stringRecordSch.optional(),
  expressionAttributeValues: genericRecordSch.optional(),
  returnConsumedCapacity: returnConsumedCapacityOptionsSch.optional(),
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
