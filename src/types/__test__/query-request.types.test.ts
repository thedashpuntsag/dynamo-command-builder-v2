import { describe, expect, it } from 'vitest';

import { dynamoReadQueryRequestSch } from '../query-request.types';
import { validateDynamoReadQueryRequest } from '../read-command.types';

/**
 * These tests model how `dynamoReadQueryRequestSch` is actually used in this
 * library: parsing raw HTTP query-string parameters (all strings) coming
 * from an AWS-console-like UI into a strongly typed Query/Scan request.
 *
 * Note: the schema only models the "operation": QUERY | SCAN family of
 * requests. GetCommand and BatchGetCommand use a different shape (item keys
 * rather than pk/sk condition slots), so those are covered separately below
 * to document that they are intentionally rejected by this schema.
 */
describe('dynamoReadQueryRequestSch', () => {
  it('parses a simple table scan with a custom limit and pagination token', () => {
    const rawQueryParams = {
      operation: 'scan',
      table: 'Orders',
      limit: '25',
      lastEvaluatedKey: JSON.stringify({ id: 'order-100' }),
    };

    const result = dynamoReadQueryRequestSch.parse(rawQueryParams);

    expect(result).toMatchObject({
      operation: 'SCAN',
      table: 'Orders',
      limit: 25,
      lastEvaluatedKey: { id: 'order-100' },
      filterJoin: 'AND',
    });
  });

  it('parses a scan with a filter condition and result sorting', () => {
    const rawQueryParams = {
      operation: 'SCAN',
      table: 'Orders',
      filterAttr1Name: 'status',
      filterAttr1Condition: 'EQUAL_TO',
      filterAttr1ValueType: 'S',
      filterAttr1Value: 'SHIPPED',
      sorting: 'desc',
    };

    expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();

    const validQueryParams = { ...rawQueryParams, sorting: undefined };

    const result = dynamoReadQueryRequestSch.parse(validQueryParams);

    expect(result).toMatchObject({
      operation: 'SCAN',
      filterAttr1Name: 'status',
      filterAttr1Condition: 'EQUAL_TO',
      filterAttr1ValueType: 'S',
      filterAttr1Value: 'SHIPPED',
    });
  });

  it('parses a query with a key condition and an additional non-key filter', () => {
    const rawQueryParams = {
      operation: 'QUERY',
      table: 'Orders',
      pkAttr1Name: 'customerId',
      pkAttr1Value: 'cust-42',
      pkAttr1ValueType: 'S',
      skAttr1Name: 'orderDate',
      skAttr1Condition: 'GREATER_THAN_OR_EQUAL_TO',
      skAttr1Value: '2026-01-01',
      skAttr1ValueType: 'S',
      filterAttr1Name: 'status',
      filterAttr1Condition: 'EQUAL_TO',
      filterAttr1ValueType: 'S',
      filterAttr1Value: 'SHIPPED',
    };

    const result = dynamoReadQueryRequestSch.parse(rawQueryParams);

    expect(result).toMatchObject({
      operation: 'QUERY',
      pkAttr1Name: 'customerId',
      pkAttr1Value: 'cust-42',
      skAttr1Name: 'orderDate',
      skAttr1Condition: 'GREATER_THAN_OR_EQUAL_TO',
      filterAttr1Name: 'status',
    });
  });

  it('parses a query with pagination and sorting options', () => {
    const rawQueryParams = {
      operation: 'QUERY',
      table: 'Orders',
      pkAttr1Name: 'customerId',
      pkAttr1Value: 'cust-42',
      sorting: 'ASC',
      limit: '10',
      lastEvaluatedKey: JSON.stringify({ customerId: 'cust-42', orderDate: '2026-01-05' }),
    };

    const result = dynamoReadQueryRequestSch.parse(rawQueryParams);

    expect(result).toMatchObject({
      sorting: 'ASC',
      limit: 10,
      lastEvaluatedKey: { customerId: 'cust-42', orderDate: '2026-01-05' },
    });
  });

  it('parses a query targeting a secondary index', () => {
    const rawQueryParams = {
      operation: 'QUERY',
      table: 'Orders',
      index: 'statusDate-index',
      pkAttr1Name: 'status',
      pkAttr1Value: 'SHIPPED',
      skAttr1Name: 'orderDate',
      skAttr1Condition: 'BETWEEN',
      skAttr1Value: '2026-01-01',
      skAttr1Value2: '2026-01-31',
    };

    const result = dynamoReadQueryRequestSch.parse(rawQueryParams);

    expect(result).toMatchObject({
      index: 'statusDate-index',
      pkAttr1Name: 'status',
      skAttr1Condition: 'BETWEEN',
      skAttr1Value2: '2026-01-31',
    });
  });

  it('rejects batch-get style requests with multiple item keys, since the schema only models QUERY/SCAN', () => {
    const rawQueryParams = {
      operation: 'BATCH_GET',
      table: 'Orders',
      keys: JSON.stringify([
        { customerId: 'cust-1', orderDate: '2026-01-01' },
        { customerId: 'cust-2', orderDate: '2026-01-02' },
      ]),
    };

    expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
  });

  it('rejects batch-get style requests that carry a pagination cursor as an unknown field', () => {
    const rawQueryParams = {
      operation: 'BATCH_GET',
      table: 'Orders',
      keys: JSON.stringify([{ id: 'order-1' }]),
      lastEvaluatedKey: JSON.stringify({ Orders: [{ id: 'order-99' }] }),
    };

    expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
  });

  describe('invalid SCAN requests', () => {
    it('rejects a SCAN with partition-key parameters', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        pkAttr1Name: 'customerId',
        pkAttr1Value: 'cust-42',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a SCAN with sort-key parameters', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        skAttr1Name: 'orderDate',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a SCAN with sorting set', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        sorting: 'ASC',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });
  });

  describe('invalid QUERY requests', () => {
    it('rejects a second partition-key condition for a traditional target', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        pkAttr1Name: 'customerId',
        pkAttr1Value: 'cust-42',
        pkAttr2Name: 'accountId',
        pkAttr2Value: 'account-7',
      };

      const request = dynamoReadQueryRequestSch.parse(rawQueryParams);
      expect(() =>
        validateDynamoReadQueryRequest(request, {
          table: { partitionKeys: [{ name: 'customerId', valueType: 'S' }], sortKeys: [] },
        })
      ).toThrow();
    });

    it('accepts ordered key conditions for a multi-attribute GSI', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        index: 'orders-index',
        pkAttr1Name: 'customerId',
        pkAttr1Value: 'cust-42',
        skAttr1Name: 'orderDate',
        skAttr1Condition: 'EQUAL_TO',
        skAttr1Value: '2026-01-01',
        skAttr2Name: 'orderId',
        skAttr2Value: 'ord-1',
      };

      const request = dynamoReadQueryRequestSch.parse(rawQueryParams);
      expect(
        validateDynamoReadQueryRequest(request, {
          table: { partitionKeys: [{ name: 'customerId', valueType: 'S' }], sortKeys: [] },
          indexes: {
            'orders-index': {
              kind: 'GSI',
              partitionKeys: [{ name: 'customerId', valueType: 'S' }],
              sortKeys: [
                { name: 'orderDate', valueType: 'S' },
                { name: 'orderId', valueType: 'S' },
              ],
            },
          },
        })
      ).toEqual(request);
    });

    it('rejects a QUERY missing the first partition-key name/value', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        skAttr1Name: 'orderDate',
        skAttr1Value: '2026-01-01',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a QUERY with parallel-scan segment parameters', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        pkAttr1Name: 'customerId',
        pkAttr1Value: 'cust-42',
        segment: '0',
        totalSegments: '4',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a partition-key slot gap', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        pkAttr1Name: 'customerId',
        pkAttr1Value: 'cust-42',
        pkAttr3Name: 'accountId',
        pkAttr3Value: 'account-7',
      };

      const request = dynamoReadQueryRequestSch.parse(rawQueryParams);
      expect(() =>
        validateDynamoReadQueryRequest(request, {
          table: { partitionKeys: [{ name: 'customerId', valueType: 'S' }], sortKeys: [] },
        })
      ).toThrow();
    });

    it('rejects a partition-key slot with a name but no value', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        pkAttr1Name: 'customerId',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a sort-key slot gap', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        pkAttr1Name: 'customerId',
        pkAttr1Value: 'cust-42',
        skAttr2Name: 'orderDate',
        skAttr2Value: '2026-01-01',
      };

      const request = dynamoReadQueryRequestSch.parse(rawQueryParams);
      expect(() =>
        validateDynamoReadQueryRequest(request, {
          table: {
            partitionKeys: [{ name: 'customerId', valueType: 'S' }],
            sortKeys: [{ name: 'orderDate', valueType: 'S' }],
          },
        })
      ).toThrow();
    });

    it('rejects a BETWEEN sort-key condition missing the second value', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        pkAttr1Name: 'customerId',
        pkAttr1Value: 'cust-42',
        skAttr1Name: 'orderDate',
        skAttr1Condition: 'BETWEEN',
        skAttr1Value: '2026-01-01',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a non-BETWEEN sort-key condition with a second value set', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        pkAttr1Name: 'customerId',
        pkAttr1Value: 'cust-42',
        skAttr1Name: 'orderDate',
        skAttr1Condition: 'EQUAL_TO',
        skAttr1Value: '2026-01-01',
        skAttr1Value2: '2026-01-02',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a BEGINS_WITH sort-key condition with a numeric value type', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        pkAttr1Name: 'customerId',
        pkAttr1Value: 'cust-42',
        skAttr1Name: 'orderId',
        skAttr1Condition: 'BEGINS_WITH',
        skAttr1Value: 'ord-',
        skAttr1ValueType: 'N',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a sort-key slot following an inequality condition', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        pkAttr1Name: 'customerId',
        pkAttr1Value: 'cust-42',
        skAttr1Name: 'orderDate',
        skAttr1Condition: 'GREATER_THAN',
        skAttr1Value: '2026-01-01',
        skAttr2Name: 'orderId',
        skAttr2Value: 'ord-1',
      };

      const request = dynamoReadQueryRequestSch.parse(rawQueryParams);
      expect(() =>
        validateDynamoReadQueryRequest(request, {
          table: {
            partitionKeys: [{ name: 'customerId', valueType: 'S' }],
            sortKeys: [{ name: 'orderDate', valueType: 'S' }],
          },
        })
      ).toThrow();
    });

    it('rejects a filter targeting a key attribute already used in the key condition', () => {
      const rawQueryParams = {
        operation: 'QUERY',
        table: 'Orders',
        pkAttr1Name: 'customerId',
        pkAttr1Value: 'cust-42',
        filterAttr1Name: 'customerId',
        filterAttr1Condition: 'EQUAL_TO',
        filterAttr1ValueType: 'S',
        filterAttr1Value: 'cust-42',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });
  });

  describe('invalid filter parameters (shared by QUERY and SCAN)', () => {
    it('rejects a filter slot gap', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        filterAttr2Name: 'status',
        filterAttr2Condition: 'EQUAL_TO',
        filterAttr2Value: 'SHIPPED',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a filter slot missing a condition', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        filterAttr1Name: 'status',
        filterAttr1Value: 'SHIPPED',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects an EXISTS condition that carries a value', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        filterAttr1Name: 'status',
        filterAttr1Condition: 'EXISTS',
        filterAttr1Value: 'SHIPPED',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a non-EXISTS condition missing a value when the type is not NULL', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        filterAttr1Name: 'status',
        filterAttr1Condition: 'EQUAL_TO',
        filterAttr1ValueType: 'S',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('normalizes an omitted NULL-type filter value to null', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        filterAttr1Name: 'archivedAt',
        filterAttr1Condition: 'EQUAL_TO',
        filterAttr1ValueType: 'NULL',
      };

      const result = dynamoReadQueryRequestSch.parse(rawQueryParams);

      expect(result.filterAttr1ValueType).toBe('NULL');
      expect(result.filterAttr1Value).toBeNull();
    });

    it('rejects a BETWEEN filter missing the second value', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        filterAttr1Name: 'total',
        filterAttr1Condition: 'BETWEEN',
        filterAttr1ValueType: 'N',
        filterAttr1Value: '10',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a BETWEEN filter with an unsupported value type', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        filterAttr1Name: 'isActive',
        filterAttr1Condition: 'BETWEEN',
        filterAttr1ValueType: 'BOOL',
        filterAttr1Value: 'true',
        filterAttr1Value2: 'false',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a BEGINS_WITH filter with an unsupported value type', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        filterAttr1Name: 'sku',
        filterAttr1Condition: 'BEGINS_WITH',
        filterAttr1ValueType: 'N',
        filterAttr1Value: '100',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });
  });

  describe('invalid parallel-scan parameters', () => {
    it('rejects a segment without a matching totalSegments', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        segment: '0',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a segment that is not smaller than totalSegments', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        segment: '2',
        totalSegments: '2',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('accepts a valid segment/totalSegments pair', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        segment: '0',
        totalSegments: '4',
      };

      const result = dynamoReadQueryRequestSch.parse(rawQueryParams);

      expect(result).toMatchObject({ segment: 0, totalSegments: 4 });
    });

    it('accepts the maximum totalSegments value', () => {
      const result = dynamoReadQueryRequestSch.parse({
        operation: 'SCAN',
        table: 'Orders',
        segment: '999999',
        totalSegments: '1000000',
      });

      expect(result.totalSegments).toBe(1_000_000);
    });

    it('rejects totalSegments above the AWS maximum', () => {
      expect(() =>
        dynamoReadQueryRequestSch.parse({
          operation: 'SCAN',
          table: 'Orders',
          segment: '0',
          totalSegments: '1000001',
        })
      ).toThrow();
    });
  });

  describe('invalid shared field values', () => {
    it('rejects unrecognized query parameters', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        foo: 'bar',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a non-positive limit', () => {
      expect(() => dynamoReadQueryRequestSch.parse({ operation: 'SCAN', table: 'Orders', limit: '0' })).toThrow();
      expect(() => dynamoReadQueryRequestSch.parse({ operation: 'SCAN', table: 'Orders', limit: '-5' })).toThrow();
    });

    it('rejects non-canonical integer query-string values', () => {
      for (const limit of ['1.5', '1e2', '0x10', ' ']) {
        expect(() => dynamoReadQueryRequestSch.parse({ operation: 'SCAN', table: 'Orders', limit })).toThrow();
      }
    });

    it('rejects an invalid lastEvaluatedKey JSON string', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        lastEvaluatedKey: 'not-json',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a non-boolean consistentRead value', () => {
      const rawQueryParams = {
        operation: 'SCAN',
        table: 'Orders',
        consistentRead: 'yes',
      };

      expect(() => dynamoReadQueryRequestSch.parse(rawQueryParams)).toThrow();
    });

    it('rejects a missing or empty table name', () => {
      expect(() => dynamoReadQueryRequestSch.parse({ operation: 'SCAN', table: '' })).toThrow();
      expect(() => dynamoReadQueryRequestSch.parse({ operation: 'SCAN' })).toThrow();
    });
  });
});
