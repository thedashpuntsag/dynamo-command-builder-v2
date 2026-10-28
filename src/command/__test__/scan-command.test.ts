import { describe, expect, it } from 'vite-plus/test';

import { CustomScanCmdInput } from '../../types/command-input.types';
import { buildValidatedScanCommand } from '../scan-command';

function build(input: unknown) {
  return buildValidatedScanCommand(input as CustomScanCmdInput);
}

describe('buildValidatedScanCommand', () => {
  it('builds a basic table scan with defaults and no expression maps', () => {
    const command = build({ tableName: 'users' });

    expect(command).toStrictEqual({
      TableName: 'users',
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
    });
    expect(command).not.toHaveProperty('ExpressionAttributeNames');
    expect(command).not.toHaveProperty('ExpressionAttributeValues');
  });

  it('builds a realistic filtered order scan', () => {
    expect(
      build({
        tableName: 'orders',
        filterExpression: '#status = :status AND #amount >= :minimumAmount',
        expressionAttributeNames: {
          '#status': 'status',
          '#amount': 'amount',
        },
        expressionAttributeValues: {
          ':status': 'CONFIRMED',
          ':minimumAmount': 1000,
        },
        limit: 50,
      })
    ).toStrictEqual({
      TableName: 'orders',
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
      Limit: 50,
      FilterExpression: '#status = :status AND #amount >= :minimumAmount',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#amount': 'amount',
      },
      ExpressionAttributeValues: {
        ':status': 'CONFIRMED',
        ':minimumAmount': 1000,
      },
    });
  });

  it('generates filter, projection, name, and value expressions from structured input', () => {
    expect(
      build({
        tableName: 'orders',
        filters: { status: 'CONFIRMED', amount: { gte: 1000 } },
        filterJoin: 'AND',
        attributes: ['id', 'status', 'customer.name', 'lines[0].sku'],
      })
    ).toStrictEqual({
      TableName: 'orders',
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
      FilterExpression: '(#conditionName0 = :conditionValue0) AND (#conditionName1 >= :conditionValue1)',
      ProjectionExpression: '#scanAttr0, #scanAttr1, #scanAttr2.#scanAttr3, #scanAttr4[0].#scanAttr5',
      ExpressionAttributeNames: {
        '#conditionName0': 'status',
        '#conditionName1': 'amount',
        '#scanAttr0': 'id',
        '#scanAttr1': 'status',
        '#scanAttr2': 'customer',
        '#scanAttr3': 'name',
        '#scanAttr4': 'lines',
        '#scanAttr5': 'sku',
      },
      ExpressionAttributeValues: { ':conditionValue0': 'CONFIRMED', ':conditionValue1': 1000 },
    });
  });

  it('supports nested structured filters without handwritten expressions', () => {
    const command = build({
      tableName: 'orders',
      filter: {
        or: [
          { attr: 'status', eq: 'READY' },
          {
            and: [
              { attr: 'total', gte: 100 },
              { attr: 'customer.name', beginsWith: 'A' },
            ],
          },
        ],
      },
    });

    expect(command.FilterExpression).toContain(' OR ');
    expect(command.FilterExpression).toContain('begins_with');
    expect(command.ExpressionAttributeNames).toMatchObject({
      '#conditionName0': 'status',
      '#conditionName2': 'customer',
    });
    expect(command.ExpressionAttributeValues).toMatchObject({
      ':conditionValue0': 'READY',
      ':conditionValue1': 100,
      ':conditionValue2': 'A',
    });
  });

  it('combines inferred aliases from filter and projection expressions', () => {
    expect(
      build({
        tableName: 'orders',
        filterExpression: '#status = :status AND #amount >= :minimumAmount',
        projectionExpression: 'id, #status, #amount, createdAt',
        expressionAttributeValues: {
          ':status': 'CONFIRMED',
          ':minimumAmount': 1000,
        },
      })
    ).toStrictEqual({
      TableName: 'orders',
      ConsistentRead: false,
      ReturnConsumedCapacity: 'NONE',
      FilterExpression: '#status = :status AND #amount >= :minimumAmount',
      ProjectionExpression: 'id, #status, #amount, createdAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#amount': 'amount',
      },
      ExpressionAttributeValues: {
        ':status': 'CONFIRMED',
        ':minimumAmount': 1000,
      },
    });
  });

  it('lets caller-provided aliases override inferred mappings', () => {
    const command = build({
      tableName: 'accounts',
      filterExpression: '#account = :accountId AND #status = :status',
      expressionAttributeNames: { '#account': 'accountId' },
      expressionAttributeValues: {
        ':accountId': 'ACC-001',
        ':status': 'ACTIVE',
      },
    });

    expect(command.ExpressionAttributeNames).toStrictEqual({
      '#account': 'accountId',
      '#status': 'status',
    });
  });

  it('silently discards unused expression mappings', () => {
    const command = build({
      tableName: 'users',
      filterExpression: '#status = :status',
      expressionAttributeNames: {
        '#status': 'status',
        '#unused': 'irrelevantAttribute',
      },
      expressionAttributeValues: {
        ':status': 'ACTIVE',
        ':unused': 123,
      },
    });

    expect(command.ExpressionAttributeNames).toStrictEqual({ '#status': 'status' });
    expect(command.ExpressionAttributeValues).toStrictEqual({ ':status': 'ACTIVE' });
  });

  it('omits unused mappings when no expressions are provided', () => {
    const command = build({
      tableName: 'users',
      expressionAttributeNames: { '#unused': 'status' },
      expressionAttributeValues: { ':unused': 'ACTIVE' },
    });

    expect(command).not.toHaveProperty('ExpressionAttributeNames');
    expect(command).not.toHaveProperty('ExpressionAttributeValues');
  });

  it('omits unused mappings when an expression has no placeholders', () => {
    const command = build({
      tableName: 'users',
      filterExpression: 'attribute_exists(id)',
      expressionAttributeNames: { '#unused': 'status' },
      expressionAttributeValues: { ':unused': 'ACTIVE' },
    });

    expect(command.FilterExpression).toBe('attribute_exists(id)');
    expect(command).not.toHaveProperty('ExpressionAttributeNames');
    expect(command).not.toHaveProperty('ExpressionAttributeValues');
  });

  it('preserves aliases for reserved attribute names', () => {
    const command = build({
      tableName: 'audit-events',
      filterExpression: '#status = :expectedStatus AND #size < :maximumSize',
      projectionExpression: 'id, #status, #size, createdAt',
      expressionAttributeNames: {
        '#status': 'status',
        '#size': 'size',
      },
      expressionAttributeValues: {
        ':expectedStatus': 'READY',
        ':maximumSize': 10000,
      },
    });

    expect(command.ExpressionAttributeNames).toStrictEqual({
      '#status': 'status',
      '#size': 'size',
    });
    expect(command.ExpressionAttributeValues).toStrictEqual({
      ':expectedStatus': 'READY',
      ':maximumSize': 10000,
    });
  });

  it('preserves native JavaScript expression values for the DocumentClient', () => {
    const command = build({
      tableName: 'requests',
      filterExpression: '#enabled = :enabled AND #version >= :version AND #metadata = :metadata',
      expressionAttributeValues: {
        ':enabled': true,
        ':version': 5,
        ':metadata': { source: 'API', retries: 2 },
      },
    });

    expect(command.ExpressionAttributeValues).toStrictEqual({
      ':enabled': true,
      ':version': 5,
      ':metadata': { source: 'API', retries: 2 },
    });
  });

  it('preserves pagination input exactly', () => {
    const exclusiveStartKey = {
      accountId: 'ACC-001',
      createdAt: '2026-10-20T10:00:00.000Z',
    };

    const command = build({
      tableName: 'orders',
      limit: 25,
      exclusiveStartKey,
    });

    expect(command.Limit).toBe(25);
    expect(command.ExclusiveStartKey).toStrictEqual(exclusiveStartKey);
  });

  it('builds an index scan with an explicit capacity option', () => {
    const command = build({
      tableName: 'orders',
      indexName: 'status-createdAt-index',
      filterExpression: '#status = :status',
      expressionAttributeValues: { ':status': 'CONFIRMED' },
      returnConsumedCapacity: 'TOTAL',
    });

    expect(command).toStrictEqual({
      TableName: 'orders',
      ConsistentRead: false,
      ReturnConsumedCapacity: 'TOTAL',
      IndexName: 'status-createdAt-index',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'CONFIRMED' },
    });
  });

  it('preserves COUNT selection without simulating scan results', () => {
    const command = build({
      tableName: 'orders',
      select: 'COUNT',
      filterExpression: '#status = :status',
      expressionAttributeValues: { ':status': 'PENDING' },
    });

    expect(command.Select).toBe('COUNT');
  });

  it('preserves segment zero in a parallel scan', () => {
    const command = build({
      tableName: 'audit-events',
      segment: 0,
      totalSegments: 4,
    });

    expect(command.Segment).toBe(0);
    expect(command.TotalSegments).toBe(4);
  });

  it('enables a strongly consistent table scan', () => {
    expect(build({ tableName: 'users', consistentRead: true }).ConsistentRead).toBe(true);
  });

  it('shares one alias scope across filter and projection expressions', () => {
    const command = build({
      tableName: 'orders',
      filterExpression: '#status = :status',
      projectionExpression: '#status, #customerName, createdAt',
      expressionAttributeNames: { '#customerName': 'customer.name' },
      expressionAttributeValues: { ':status': 'ACTIVE' },
    });

    expect(command.ExpressionAttributeNames).toStrictEqual({
      '#status': 'status',
      '#customerName': 'customer.name',
    });
  });

  it('deduplicates repeated name and value token references', () => {
    const command = build({
      tableName: 'orders',
      filterExpression: '#status = :status OR #status = :status',
      projectionExpression: '#status, id, #status',
      expressionAttributeValues: { ':status': 'ACTIVE' },
    });

    expect(command.ExpressionAttributeNames).toStrictEqual({ '#status': 'status' });
    expect(command.ExpressionAttributeValues).toStrictEqual({ ':status': 'ACTIVE' });
  });

  it('keeps null, false, and zero when their tokens are referenced', () => {
    const command = build({
      tableName: 'requests',
      filterExpression: '#deletedAt = :deletedAt AND #enabled = :enabled AND #attempts = :attempts',
      expressionAttributeValues: {
        ':deletedAt': null,
        ':enabled': false,
        ':attempts': 0,
      },
    });

    expect(command.ExpressionAttributeValues).toStrictEqual({
      ':deletedAt': null,
      ':enabled': false,
      ':attempts': 0,
    });
  });

  it('rejects a missing referenced expression value', () => {
    expect(() =>
      build({
        tableName: 'orders',
        filterExpression: '#status = :status AND #amount >= :minimumAmount',
        expressionAttributeValues: { ':status': 'CONFIRMED' },
      })
    ).toThrow('Missing expression attribute value: ":minimumAmount".');
  });

  it('rejects an undefined referenced expression value', () => {
    expect(() =>
      build({
        tableName: 'orders',
        filterExpression: '#status = :status',
        expressionAttributeValues: { ':status': undefined },
      })
    ).toThrow(/without undefined/);
  });

  it.each([
    ['missing table name', {}],
    ['empty table name', { tableName: '' }],
    ['whitespace-only table name', { tableName: '   ' }],
    ['zero limit', { tableName: 'orders', limit: 0 }],
    ['negative limit', { tableName: 'orders', limit: -1 }],
    ['non-integer limit', { tableName: 'orders', limit: 1.5 }],
    ['segment without totalSegments', { tableName: 'orders', segment: 0 }],
    ['totalSegments without segment', { tableName: 'orders', totalSegments: 4 }],
    ['segment equal to totalSegments', { tableName: 'orders', segment: 4, totalSegments: 4 }],
    ['segment greater than totalSegments', { tableName: 'orders', segment: 5, totalSegments: 4 }],
    ['negative segment', { tableName: 'orders', segment: -1, totalSegments: 4 }],
    ['invalid select value', { tableName: 'orders', select: 'ITEMS' }],
    [
      'multiple filter modes',
      { tableName: 'orders', filters: { status: 'READY' }, filterExpression: '#status = :status' },
    ],
    ['filterJoin without filters', { tableName: 'orders', filterJoin: 'OR' }],
    ['COUNT with a projection', { tableName: 'orders', select: 'COUNT', projectionExpression: 'id, createdAt' }],
    ['SPECIFIC_ATTRIBUTES without a projection', { tableName: 'orders', select: 'SPECIFIC_ATTRIBUTES' }],
    ['invalid capacity option', { tableName: 'orders', returnConsumedCapacity: 'ALL' }],
    ['unsupported top-level property', { tableName: 'orders', scanForward: false }],
  ])('rejects %s', (_description, input) => {
    expect(() => build(input)).toThrow();
  });
});
