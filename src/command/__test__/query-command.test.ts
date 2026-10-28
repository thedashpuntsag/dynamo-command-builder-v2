import { describe, expect, it, vi } from 'vite-plus/test';

import { CustomQueryCmdInput } from '../../types/command-input.types';
import { buildQueryCommandInput, buildValidatedQueryCommand } from '../query-command';

function build(input: unknown) {
  return buildValidatedQueryCommand(input as CustomQueryCmdInput);
}

describe('buildValidatedQueryCommand', () => {
  it('builds a basic query without a table definition', () => {
    expect(
      build({
        tableName: 'Orders',
        partitionKeys: { customerId: 'cust-42' },
      })
    ).toStrictEqual({
      TableName: 'Orders',
      KeyConditionExpression: '#pk0 = :pk0',
      ConsistentRead: false,
      ScanIndexForward: true,
      ReturnConsumedCapacity: 'NONE',
      ExpressionAttributeNames: { '#pk0': 'customerId' },
      ExpressionAttributeValues: { ':pk0': 'cust-42' },
    });
  });

  it('builds named multi-attribute GSI conditions in object order', () => {
    const command = build({
      tableName: 'Orders',
      indexName: 'byTenantRegionAndDate',
      partitionKeys: {
        tenantId: 'tenant-1',
        region: 'MN',
        configType: 'PAYMENT',
      },
      sortKeys: {
        year: 2026,
        month: 10,
        createdAt: { between: [100, 200] },
      },
    });

    expect(command).toMatchObject({
      IndexName: 'byTenantRegionAndDate',
      KeyConditionExpression:
        '#pk0 = :pk0 AND #pk1 = :pk1 AND #pk2 = :pk2 AND #sk0 = :sk0 AND #sk1 = :sk1 AND #sk2 BETWEEN :sk2Start AND :sk2End',
      ExpressionAttributeNames: {
        '#pk0': 'tenantId',
        '#pk1': 'region',
        '#pk2': 'configType',
        '#sk0': 'year',
        '#sk1': 'month',
        '#sk2': 'createdAt',
      },
      ExpressionAttributeValues: {
        ':pk0': 'tenant-1',
        ':pk1': 'MN',
        ':pk2': 'PAYMENT',
        ':sk0': 2026,
        ':sk1': 10,
        ':sk2Start': 100,
        ':sk2End': 200,
      },
    });
  });

  it('builds a multi-attribute GSI query with four partition and four sort attributes', () => {
    const command = buildValidatedQueryCommand({
      tableName: 'Orders',
      indexName: 'byTenantRegionTypeChannelDate',
      partitionKeys: {
        tenantId: 'tenant-1',
        region: 'MN',
        entityType: 'ORDER',
        channel: 'WEB',
      },
      sortKeys: {
        year: 2026,
        month: 10,
        day: 28,
        createdAt: { between: ['2026-10-28T00:00:00.000Z', '2026-10-28T23:59:59.999Z'] },
      },
    });

    expect(command).toStrictEqual({
      TableName: 'Orders',
      IndexName: 'byTenantRegionTypeChannelDate',
      KeyConditionExpression:
        '#pk0 = :pk0 AND #pk1 = :pk1 AND #pk2 = :pk2 AND #pk3 = :pk3 AND #sk0 = :sk0 AND #sk1 = :sk1 AND #sk2 = :sk2 AND #sk3 BETWEEN :sk3Start AND :sk3End',
      ExpressionAttributeNames: {
        '#pk0': 'tenantId',
        '#pk1': 'region',
        '#pk2': 'entityType',
        '#pk3': 'channel',
        '#sk0': 'year',
        '#sk1': 'month',
        '#sk2': 'day',
        '#sk3': 'createdAt',
      },
      ExpressionAttributeValues: {
        ':pk0': 'tenant-1',
        ':pk1': 'MN',
        ':pk2': 'ORDER',
        ':pk3': 'WEB',
        ':sk0': 2026,
        ':sk1': 10,
        ':sk2': 28,
        ':sk3Start': '2026-10-28T00:00:00.000Z',
        ':sk3End': '2026-10-28T23:59:59.999Z',
      },
      ConsistentRead: false,
      ScanIndexForward: true,
      ReturnConsumedCapacity: 'NONE',
    });
  });

  it.each([
    [{ lt: 10 }, '#sk0 < :sk0'],
    [{ lte: 10 }, '#sk0 <= :sk0'],
    [{ gt: 10 }, '#sk0 > :sk0'],
    [{ gte: 10 }, '#sk0 >= :sk0'],
    [{ beginsWith: 'ORDER#' }, 'begins_with(#sk0, :sk0)'],
  ])('builds the sort-key condition %j', (condition, expectedExpression) => {
    const command = build({
      tableName: 'Orders',
      partitionKeys: { customerId: 'cust-42' },
      sortKeys: { createdAt: condition },
    });

    expect(command.KeyConditionExpression).toBe(`#pk0 = :pk0 AND ${expectedExpression}`);
  });

  it('supports filter and projection expressions in the generated token scope', () => {
    const command = build({
      tableName: 'Orders',
      partitionKeys: { customerId: 'cust-42' },
      filterExpression: '#status = :status',
      projectionExpression: 'id, #status, #order',
      expressionAttributeNames: { '#order': 'order' },
      expressionAttributeValues: { ':status': 'ACTIVE', ':unused': true },
    });

    expect(command.ExpressionAttributeNames).toStrictEqual({
      '#pk0': 'customerId',
      '#status': 'status',
      '#order': 'order',
    });
    expect(command.ExpressionAttributeValues).toStrictEqual({
      ':pk0': 'cust-42',
      ':status': 'ACTIVE',
    });
  });

  it('generates expressions from structured filters and projection attributes', () => {
    const command = build({
      tableName: 'Orders',
      partitionKeys: { customerId: 'cust-42' },
      filters: {
        status: 'ACTIVE',
        total: { gte: 1000 },
        archivedAt: { notExists: true },
      },
      attributes: ['orderId', 'status', 'customer.profile.name', 'items[0].sku'],
    });

    expect(command.FilterExpression).toBe(
      '#filter0 = :filter0 AND #filter1 >= :filter1 AND attribute_not_exists(#filter2)'
    );
    expect(command.ProjectionExpression).toBe(
      '#projection0_0, #projection1_0, #projection2_0.#projection2_1.#projection2_2, #projection3_0[0].#projection3_2'
    );
    expect(command.ExpressionAttributeValues).toMatchObject({
      ':filter0': 'ACTIVE',
      ':filter1': 1000,
    });
    expect(command.ExpressionAttributeNames).toMatchObject({
      '#filter0': 'status',
      '#filter1': 'total',
      '#filter2': 'archivedAt',
      '#projection0_0': 'orderId',
      '#projection1_0': 'status',
      '#projection2_0': 'customer',
      '#projection2_1': 'profile',
      '#projection2_2': 'name',
      '#projection3_0': 'items',
      '#projection3_2': 'sku',
    });
  });

  it.each([
    [{ eq: 'ACTIVE' }, '#filter0 = :filter0'],
    [{ ne: 'DELETED' }, '#filter0 <> :filter0'],
    [{ lt: 10 }, '#filter0 < :filter0'],
    [{ lte: 10 }, '#filter0 <= :filter0'],
    [{ gt: 10 }, '#filter0 > :filter0'],
    [{ gte: 10 }, '#filter0 >= :filter0'],
    [{ between: [10, 20] }, '#filter0 BETWEEN :filter0Start AND :filter0End'],
    [{ beginsWith: 'ORDER#' }, 'begins_with(#filter0, :filter0)'],
    [{ contains: 'vip' }, 'contains(#filter0, :filter0)'],
    [{ notContains: 'blocked' }, 'NOT contains(#filter0, :filter0)'],
    [{ exists: true }, 'attribute_exists(#filter0)'],
    [{ notExists: true }, 'attribute_not_exists(#filter0)'],
  ])('builds the structured filter condition %j', (condition, expectedExpression) => {
    const command = build({
      tableName: 'Orders',
      partitionKeys: { customerId: 'cust-42' },
      filters: { status: condition },
    });

    expect(command.FilterExpression).toBe(expectedExpression);
  });

  it('combines raw and structured filters with collision-safe tokens', () => {
    const command = build({
      tableName: 'Orders',
      partitionKeys: { customerId: 'cust-42' },
      filterExpression: '#filter0 = :filter0',
      expressionAttributeValues: { ':filter0': 'PENDING' },
      filters: { status: 'ACTIVE' },
      filterJoin: 'OR',
    });

    expect(command.FilterExpression).toBe('#filter0 = :filter0 OR #filter0_1 = :filter0_1');
    expect(command.ExpressionAttributeNames).toMatchObject({
      '#filter0': 'filter0',
      '#filter0_1': 'status',
    });
    expect(command.ExpressionAttributeValues).toMatchObject({
      ':filter0': 'PENDING',
      ':filter0_1': 'ACTIVE',
    });
  });

  it('avoids collisions with caller-provided expression tokens', () => {
    const command = build({
      tableName: 'Orders',
      partitionKeys: { customerId: 'cust-42' },
      filterExpression: '#pk0 = :pk0',
      expressionAttributeNames: { '#pk0': 'status' },
      expressionAttributeValues: { ':pk0': 'ACTIVE' },
    });

    expect(command.KeyConditionExpression).toBe('#pk0_1 = :pk0_1');
    expect(command.ExpressionAttributeNames).toStrictEqual({
      '#pk0_1': 'customerId',
      '#pk0': 'status',
    });
    expect(command.ExpressionAttributeValues).toStrictEqual({
      ':pk0_1': 'cust-42',
      ':pk0': 'ACTIVE',
    });
  });

  it('preserves query options', () => {
    const exclusiveStartKey = { customerId: 'cust-42', createdAt: 100 };
    const command = build({
      tableName: 'Orders',
      indexName: 'byCustomer',
      partitionKeys: { customerId: 'cust-42' },
      limit: 25,
      consistentRead: true,
      scanIndexForward: false,
      exclusiveStartKey,
      returnConsumedCapacity: 'TOTAL',
    });

    expect(command).toMatchObject({
      IndexName: 'byCustomer',
      Limit: 25,
      ConsistentRead: true,
      ScanIndexForward: false,
      ExclusiveStartKey: exclusiveStartKey,
      ReturnConsumedCapacity: 'TOTAL',
    });
  });

  it('rejects more than four partition keys', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() =>
      build({
        tableName: 'Orders',
        partitionKeys: { first: '1', second: '2', third: '3', fourth: '4', fifth: '5' },
      })
    ).toThrow();
  });

  it('rejects a range condition before the final sort key', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() =>
      build({
        tableName: 'Orders',
        partitionKeys: { customerId: 'cust-42' },
        sortKeys: {
          createdAt: { gte: 100 },
          orderId: 'order-1',
        },
      })
    ).toThrow('non-equality sort-key condition must be the final');
  });

  it('rejects integer-like key names whose object order is unstable', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() =>
      build({
        tableName: 'Orders',
        partitionKeys: { 1: 'value' },
      })
    ).toThrow('Integer-like attribute names are not supported');
  });

  it('rejects missing filter expression values', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() =>
      build({
        tableName: 'Orders',
        partitionKeys: { customerId: 'cust-42' },
        filterExpression: '#status = :status',
      })
    ).toThrow('Missing expression attribute value: ":status"');
  });

  it('exports buildQueryCommandInput as the concise API', () => {
    expect(
      buildQueryCommandInput({
        tableName: 'Orders',
        partitionKeys: { customerId: 'cust-42' },
      }).TableName
    ).toBe('Orders');
  });
});
