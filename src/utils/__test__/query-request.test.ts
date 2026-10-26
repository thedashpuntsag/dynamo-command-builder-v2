import { describe, expect, it } from 'vite-plus/test';

import { buildValidatedQueryCommand } from '../../command/query-command';
import {
  convertDynamoReadQueryRequest,
  convertDynamoReadQueryRequestToCustomQueryInput,
  getCustomQueryInputFromApiGatewayEvent,
} from '../query-request';

describe('convertDynamoReadQueryRequestToCustomQueryInput', () => {
  it('converts typed composite keys and filters', () => {
    const input = convertDynamoReadQueryRequestToCustomQueryInput({
      operation: 'QUERY',
      table: 'Orders',
      index: 'byTenantRegionAndDate',
      pkAttr1Name: 'tenantId',
      pkAttr1Value: 'tenant-1',
      pkAttr2Name: 'region',
      pkAttr2Value: 'MN',
      skAttr1Name: 'year',
      skAttr1Value: '2026',
      skAttr1ValueType: 'N',
      skAttr2Name: 'createdAt',
      skAttr2Condition: 'BETWEEN',
      skAttr2Value: '100',
      skAttr2Value2: '200',
      skAttr2ValueType: 'N',
      filterJoin: 'OR',
      filterAttr1Name: 'status',
      filterAttr1Condition: 'EQUAL_TO',
      filterAttr1Value: 'ACTIVE',
      filterAttr2Name: 'archivedAt',
      filterAttr2Condition: 'NOT_EXISTS',
      sorting: 'DESC',
      limit: '25',
    });

    expect(input).toStrictEqual({
      tableName: 'Orders',
      indexName: 'byTenantRegionAndDate',
      partitionKeys: { tenantId: 'tenant-1', region: 'MN' },
      sortKeys: {
        year: 2026,
        createdAt: { between: [100, 200] },
      },
      filterExpression: '#filter0 = :filter0 OR attribute_not_exists(#filter1)',
      expressionAttributeNames: {
        '#filter0': 'status',
        '#filter1': 'archivedAt',
      },
      expressionAttributeValues: { ':filter0': 'ACTIVE' },
      limit: 25,
      consistentRead: false,
      scanIndexForward: false,
      returnConsumedCapacity: 'NONE',
    });
  });

  it('preserves projection aliases and avoids filter-token collisions', () => {
    const input = convertDynamoReadQueryRequestToCustomQueryInput({
      operation: 'QUERY',
      table: 'Orders',
      pkAttr1Name: 'customerId',
      pkAttr1Value: 'cust-1',
      projectionExpression: '#filter0, createdAt',
      expressionAttributeNames: { '#filter0': 'projectedStatus' },
      filterAttr1Name: 'status',
      filterAttr1Condition: 'EQUAL_TO',
      filterAttr1Value: 'ACTIVE',
    });

    expect(input.expressionAttributeNames).toStrictEqual({
      '#filter0': 'projectedStatus',
      '#filter0_1': 'status',
    });
    expect(input.filterExpression).toBe('#filter0_1 = :filter0');
  });

  it('creates input accepted by the query command builder', () => {
    const customInput = convertDynamoReadQueryRequest({
      operation: 'QUERY',
      table: 'Orders',
      pkAttr1Name: 'customerId',
      pkAttr1Value: 'cust-1',
      skAttr1Name: 'createdAt',
      skAttr1Condition: 'GREATER_THAN_OR_EQUAL_TO',
      skAttr1Value: '100',
      skAttr1ValueType: 'N',
    });

    expect(buildValidatedQueryCommand(customInput)).toMatchObject({
      TableName: 'Orders',
      KeyConditionExpression: '#pk0 = :pk0 AND #sk0 >= :sk0',
      ExpressionAttributeValues: { ':pk0': 'cust-1', ':sk0': 100 },
    });
  });

  it('rejects scan requests', () => {
    expect(() => convertDynamoReadQueryRequestToCustomQueryInput({ operation: 'SCAN', table: 'Orders' })).toThrow(
      'Only QUERY requests'
    );
  });

  it('rejects duplicate key attribute names', () => {
    expect(() =>
      convertDynamoReadQueryRequestToCustomQueryInput({
        operation: 'QUERY',
        table: 'Orders',
        pkAttr1Name: 'id',
        pkAttr1Value: 'tenant-1',
        skAttr1Name: 'id',
        skAttr1Value: 'order-1',
      })
    ).toThrow('Duplicate query key attribute: "id"');
  });

  it('rejects pkAttr2 when pkAttr1 is missing', () => {
    expect(() =>
      convertDynamoReadQueryRequestToCustomQueryInput({
        operation: 'QUERY',
        table: 'Orders',
        pkAttr2Name: 'region',
        pkAttr2Value: 'MN',
      })
    ).toThrow();
  });
});

describe('getCustomQueryInputFromApiGatewayEvent', () => {
  const defaultInput = {
    tableName: 'Orders',
    partitionKeys: { status: 'ACTIVE' },
  } as const;

  it('extracts and converts API Gateway query-string parameters', () => {
    expect(
      getCustomQueryInputFromApiGatewayEvent(
        {
          queryStringParameters: {
            operation: 'QUERY',
            table: 'Orders',
            pkAttr1Name: 'customerId',
            pkAttr1Value: 'customer-1',
            skAttr1Name: 'createdAt',
            skAttr1Condition: 'GREATER_THAN',
            skAttr1Value: '100',
            skAttr1ValueType: 'N',
            limit: '25',
          },
        },
        defaultInput
      )
    ).toStrictEqual({
      tableName: 'Orders',
      partitionKeys: { customerId: 'customer-1' },
      sortKeys: { createdAt: { gt: 100 } },
      limit: 25,
      consistentRead: false,
      scanIndexForward: true,
      returnConsumedCapacity: 'NONE',
    });
  });

  it.each([
    {},
    { queryStringParameters: null },
    { queryStringParameters: {} },
    { queryStringParameters: { operation: undefined } },
  ])('returns the validated default when parameters are absent: %j', (event) => {
    expect(getCustomQueryInputFromApiGatewayEvent(event, defaultInput)).toStrictEqual({
      tableName: 'Orders',
      partitionKeys: { status: 'ACTIVE' },
      sortKeys: {},
      consistentRead: false,
      scanIndexForward: true,
      returnConsumedCapacity: 'NONE',
    });
  });

  it('does not hide invalid provided parameters behind the default', () => {
    expect(() =>
      getCustomQueryInputFromApiGatewayEvent(
        {
          queryStringParameters: {
            operation: 'QUERY',
            table: 'Orders',
            pkAttr2Name: 'region',
            pkAttr2Value: 'MN',
          },
        },
        defaultInput
      )
    ).toThrow();
  });

  it('validates the default before returning it', () => {
    expect(() =>
      getCustomQueryInputFromApiGatewayEvent(
        { queryStringParameters: null },
        { tableName: 'Orders', partitionKeys: {} }
      )
    ).toThrow();
  });
});
