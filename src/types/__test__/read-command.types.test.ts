import { describe, expect, it } from 'vitest';

import {
  decodeDynamoValue,
  dynamoBatchGetRequestSch,
  dynamoGetRequestSch,
  dynamoTransactGetRequestSch,
  validateDynamoReadQueryRequest,
} from '../read-command.types';
import { dynamoReadQueryRequestSch } from '../query-request.types';

describe('read command schemas', () => {
  it('validates Get requests with a complete-shaped key', () => {
    expect(dynamoGetRequestSch.parse({ operation: 'GET', table: 'Orders', key: { id: 'order-1' } })).toMatchObject({
      operation: 'GET',
    });
  });

  it('enforces BatchGet key count and rejects duplicate keys', () => {
    const duplicate = {
      operation: 'BATCH_GET',
      requestItems: { Orders: { keys: [{ id: '1' }, { id: '1' }] } },
    };
    expect(() => dynamoBatchGetRequestSch.parse(duplicate)).toThrow('Duplicate BatchGet key.');
    expect(() => dynamoBatchGetRequestSch.parse({ operation: 'BATCH_GET', requestItems: {} })).toThrow();
  });

  it('validates ordered TransactGet items without per-item capacity', () => {
    const request = dynamoTransactGetRequestSch.parse({
      operation: 'TRANSACT_GET',
      transactItems: [{ table: 'Orders', key: { id: '1' }, projectionExpression: '#id' }],
    });
    expect(request.transactItems).toHaveLength(1);
    expect(() =>
      dynamoTransactGetRequestSch.parse({
        operation: 'TRANSACT_GET',
        transactItems: [{ table: 'Orders', key: { id: '1' }, returnConsumedCapacity: 'TOTAL' }],
      })
    ).toThrow();
  });

  it('decodes typed HTTP values to native values', () => {
    expect(decodeDynamoValue('42', 'N')).toBe(42);
    expect(decodeDynamoValue('true', 'BOOL')).toBe(true);
    expect(decodeDynamoValue(undefined, 'NULL')).toBeNull();
    expect(Array.from(decodeDynamoValue('AQI=', 'B') as Uint8Array)).toEqual([1, 2]);
  });

  it('validates multi-attribute GSI key ordering and GSI consistency', () => {
    const request = dynamoReadQueryRequestSch.parse({
      operation: 'QUERY',
      table: 'Orders',
      index: 'gsi',
      pkAttr1Name: 'tenant',
      pkAttr1Value: 't1',
      pkAttr2Name: 'region',
      pkAttr2Value: 'west',
      skAttr1Name: 'created',
      skAttr1Condition: 'EQUAL_TO',
      skAttr1Value: '2026',
      skAttr2Name: 'id',
      skAttr2Condition: 'GREATER_THAN',
      skAttr2Value: '1',
    });
    const metadata = {
      table: { partitionKeys: [{ name: 'id', valueType: 'S' as const }], sortKeys: [] },
      indexes: {
        gsi: {
          kind: 'GSI' as const,
          partitionKeys: [
            { name: 'tenant', valueType: 'S' as const },
            { name: 'region', valueType: 'S' as const },
          ],
          sortKeys: [
            { name: 'created', valueType: 'S' as const },
            { name: 'id', valueType: 'S' as const },
          ],
        },
      },
    };
    expect(validateDynamoReadQueryRequest(request, metadata)).toEqual(request);
    expect(() => validateDynamoReadQueryRequest({ ...request, consistentRead: true }, metadata)).toThrow();
  });
});
