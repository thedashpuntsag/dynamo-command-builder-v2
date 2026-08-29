import { describe, expect, it } from 'vitest';
import { dynamoReadQueryRequestSch } from '../../src/types/query-request.types';

describe('dynamoReadQueryRequestSch', () => {
  it('parses a realistic indexed query request', () => {
    const result = dynamoReadQueryRequestSch.safeParse({
      operation: ' query ',
      table: ' orders ',
      index: ' OrdersByCustomer ',
      region: ' ap-southeast-1 ',
      pkAttr1Name: ' customerId ',
      pkAttr1Value: ' customer-123 ',
      pkAttr1ValueType: 'S',
      skAttr1Name: ' createdAt ',
      skAttr1Condition: 'BETWEEN',
      skAttr1Value: '2026-01-01T00:00:00Z',
      skAttr1Value2: '2026-01-31T23:59:59Z',
      skAttr1ValueType: 'S',
      filterJoin: 'AND',
      filterAttr1Name: 'status',
      filterAttr1Condition: 'EQUAL_TO',
      filterAttr1ValueType: 'S',
      filterAttr1Value: 'PAID',
      filterAttr2Name: 'totalCents',
      filterAttr2Condition: 'GREATER_THAN_OR_EQUAL_TO',
      filterAttr2ValueType: 'N',
      filterAttr2Value: '1000',
      sorting: 'desc',
      limit: '25',
      consistentRead: 'true',
      lastEvaluatedKey: '{"customerId":{"S":"customer-123"},"createdAt":{"S":"2026-01-15T12:00:00Z"}}',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toMatchObject({
      operation: 'QUERY',
      table: 'orders',
      index: 'OrdersByCustomer',
      pkAttr1Name: 'customerId',
      pkAttr1Value: 'customer-123',
      skAttr1Condition: 'BETWEEN',
      sorting: 'DESC',
      limit: 25,
      consistentRead: true,
      lastEvaluatedKey: {
        customerId: { S: 'customer-123' },
        createdAt: { S: '2026-01-15T12:00:00Z' },
      },
    });
  });

  it('parses a parallel scan request', () => {
    const result = dynamoReadQueryRequestSch.safeParse({
      operation: 'SCAN',
      table: 'events',
      region: 'us-east-1',
      limit: '100',
      segment: '2',
      totalSegments: '8',
      consistentRead: false,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toMatchObject({
      operation: 'SCAN',
      limit: 100,
      segment: 2,
      totalSegments: 8,
      consistentRead: false,
    });
  });

  it('rejects an API query that tries to filter on its partition key', () => {
    const result = dynamoReadQueryRequestSch.safeParse({
      operation: 'QUERY',
      table: 'orders',
      pkAttr1Name: 'customerId',
      pkAttr1Value: 'customer-123',
      filterAttr1Name: 'customerId',
      filterAttr1Condition: 'EQUAL_TO',
      filterAttr1ValueType: 'S',
      filterAttr1Value: 'customer-456',
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.message)).toContain(
      'Query filters cannot target key attributes. Use a key condition.'
    );
  });
});
