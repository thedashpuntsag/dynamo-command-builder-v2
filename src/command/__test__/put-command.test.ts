import { describe, expect, it } from 'vite-plus/test';

import { CustomPutCmdInput } from '../../types/command-input.types';
import { buildValidatedPutCommand } from '../put-command';

function build(input: unknown) {
  return buildValidatedPutCommand(input as CustomPutCmdInput);
}

describe('buildValidatedPutCommand', () => {
  it('builds a realistic document with nested native JavaScript values', () => {
    const item = {
      id: 'order-2026-000184',
      userId: 'user-001',
      status: 'PENDING',
      version: 4,
      active: true,
      amount: 1249.75,
      tags: ['priority', 'mobile'],
      metadata: {
        source: 'WEB',
        ipAddress: '192.168.1.20',
        device: {
          platform: 'iOS',
          version: '26.0',
        },
      },
      items: [
        {
          symbol: 'AAPL',
          quantity: 10,
          price: 247.31,
        },
        {
          symbol: 'NVDA',
          quantity: 5,
          price: 188.42,
        },
      ],
      nullableField: null,
    };

    const command = build({
      tableName: 'orders',
      item,
    });

    expect(command).toEqual({
      TableName: 'orders',
      Item: item,
      ReturnValues: 'NONE',
      ReturnConsumedCapacity: 'NONE',
      ReturnItemCollectionMetrics: 'NONE',
      ReturnValuesOnConditionCheckFailure: 'NONE',
    });

    expect(command.Item).toStrictEqual(item);
  });

  it('builds a create-only put using attribute_not_exists on the primary key', () => {
    const command = build({
      tableName: 'users',
      item: {
        id: 'user-001',
        email: 'dash@example.com',
        status: 'ACTIVE',
        createdAt: '2026-10-12T15:00:00.000Z',
      },
      conditionExpression: 'attribute_not_exists(#id)',
      expressionAttributeNames: {
        '#id': 'id',
      },
      returnValues: 'ALL_OLD',
    });

    expect(command).toEqual({
      TableName: 'users',
      Item: {
        id: 'user-001',
        email: 'dash@example.com',
        status: 'ACTIVE',
        createdAt: '2026-10-12T15:00:00.000Z',
      },
      ConditionExpression: 'attribute_not_exists(#id)',
      ExpressionAttributeNames: {
        '#id': 'id',
      },
      ReturnValues: 'ALL_OLD',
      ReturnConsumedCapacity: 'NONE',
      ReturnValuesOnConditionCheckFailure: 'NONE',
      ReturnItemCollectionMetrics: 'NONE',
    });
  });

  it('builds an optimistic-locking conditional put with realistic expression values', () => {
    const command = build({
      tableName: 'orders',
      item: {
        id: 'order-001',
        status: 'CONFIRMED',
        version: 8,
        updatedAt: '2026-10-12T15:30:00.000Z',
      },
      conditionExpression: '#version = :expectedVersion AND #status = :expectedStatus',
      expressionAttributeNames: {
        '#version': 'version',
        '#status': 'status',
      },
      expressionAttributeValues: {
        ':expectedVersion': 7,
        ':expectedStatus': 'PENDING',
      },
      returnConsumedCapacity: 'TOTAL',
    });

    expect(command.ConditionExpression).toBe('#version = :expectedVersion AND #status = :expectedStatus');

    expect(command.ExpressionAttributeNames).toEqual({
      '#version': 'version',
      '#status': 'status',
    });

    expect(command.ExpressionAttributeValues).toEqual({
      ':expectedVersion': 7,
      ':expectedStatus': 'PENDING',
    });

    expect(command.ExpressionAttributeValues?.[':expectedVersion']).toBe(7);
  });

  it('handles reserved DynamoDB attribute names through aliases in a realistic condition', () => {
    const command = build({
      tableName: 'audit-events',
      item: {
        id: 'event-001',
        status: 'READY',
        size: 4096,
        name: 'document.pdf',
        timestamp: '2026-10-12T16:00:00.000Z',
      },
      conditionExpression: '#status = :expectedStatus AND #size < :maxSize AND attribute_exists(#name)',
      expressionAttributeNames: {
        '#status': 'status',
        '#size': 'size',
        '#name': 'name',
      },
      expressionAttributeValues: {
        ':expectedStatus': 'PENDING',
        ':maxSize': 10_000,
      },
    });

    expect(command.ExpressionAttributeNames).toEqual({
      '#status': 'status',
      '#size': 'size',
      '#name': 'name',
    });

    expect(command.ExpressionAttributeValues).toEqual({
      ':expectedStatus': 'PENDING',
      ':maxSize': 10_000,
    });
  });

  it('merges generated aliases with caller-provided aliases when both are actually used', () => {
    const command = build({
      tableName: 'positions',
      item: {
        accountId: 'ACC-001',
        symbol: 'NVDA',
        status: 'OPEN',
        version: 11,
      },
      conditionExpression: '#status = :expectedStatus AND #account = :accountId AND #version = :expectedVersion',
      expressionAttributeNames: {
        '#account': 'accountId',
      },
      expressionAttributeValues: {
        ':expectedStatus': 'OPEN',
        ':accountId': 'ACC-001',
        ':expectedVersion': 10,
      },
    });

    expect(command.ExpressionAttributeNames).toEqual({
      '#status': 'status',
      '#version': 'version',
      '#account': 'accountId',
    });
  });

  it('preserves referenced native JavaScript values and removes unused tokens', () => {
    const command = build({
      tableName: 'requests',
      item: {
        id: 'request-001',
      },
      conditionExpression:
        '#version = :expectedVersion AND #enabled = :enabled AND #metadata = :metadata AND contains(#tags, :requiredTag)',
      expressionAttributeNames: {
        '#version': 'version',
        '#enabled': 'enabled',
        '#metadata': 'metadata',
        '#tags': 'tags',
        '#unused': 'unused',
      },
      expressionAttributeValues: {
        ':expectedVersion': 12,
        ':enabled': true,
        ':metadata': {
          source: 'API',
          retries: 2,
        },
        ':tags': ['risk', 'manual-review'],
        ':unused': 'SHOULD_BE_REMOVED',
        ':requiredTag': 'risk',
      },
    });

    expect(command.ExpressionAttributeNames).toStrictEqual({
      '#version': 'version',
      '#enabled': 'enabled',
      '#metadata': 'metadata',
      '#tags': 'tags',
    });

    expect(command.ExpressionAttributeValues).toStrictEqual({
      ':expectedVersion': 12,
      ':enabled': true,
      ':metadata': {
        source: 'API',
        retries: 2,
      },
      ':requiredTag': 'risk',
    });

    expect(command.ExpressionAttributeValues).not.toHaveProperty(':unused');
    expect(command.ExpressionAttributeValues).not.toHaveProperty(':tags');
    expect(command.ExpressionAttributeNames).not.toHaveProperty('#unused');
  });
  it('preserves native JavaScript values referenced by the condition', () => {
    const metadata = {
      source: 'API',
      retries: 2,
      tags: ['risk', 'manual-review'],
    };

    const command = build({
      tableName: 'requests',
      item: {
        id: 'request-001',
      },
      conditionExpression: '#version = :expectedVersion AND #enabled = :enabled AND #metadata = :metadata',
      expressionAttributeNames: {
        '#version': 'version',
        '#enabled': 'enabled',
        '#metadata': 'metadata',
      },
      expressionAttributeValues: {
        ':expectedVersion': 12,
        ':enabled': true,
        ':metadata': metadata,
      },
    });

    expect(command.ExpressionAttributeValues).toStrictEqual({
      ':expectedVersion': 12,
      ':enabled': true,
      ':metadata': metadata,
    });

    expect(command.ExpressionAttributeValues?.[':expectedVersion']).toBe(12);
    expect(command.ExpressionAttributeValues?.[':enabled']).toBe(true);
    expect(command.ExpressionAttributeValues?.[':metadata']).toStrictEqual(metadata);
  });

  it('silently removes unused expression attribute names and values', () => {
    const command = build({
      tableName: 'orders',
      item: {
        id: 'order-001',
        status: 'CONFIRMED',
      },
      conditionExpression: '#status = :expectedStatus',
      expressionAttributeNames: {
        '#status': 'status',
        '#unused': 'someOtherAttribute',
        '#anotherUnused': 'version',
      },
      expressionAttributeValues: {
        ':expectedStatus': 'PENDING',
        ':unused': 123,
        ':anotherUnused': {
          active: true,
        },
      },
    });

    expect(command.ConditionExpression).toBe('#status = :expectedStatus');

    expect(command.ExpressionAttributeNames).toStrictEqual({
      '#status': 'status',
    });

    expect(command.ExpressionAttributeValues).toStrictEqual({
      ':expectedStatus': 'PENDING',
    });
  });

  it('allows explicit alias mappings to override inferred shorthand names', () => {
    const command = build({
      tableName: 'positions',
      item: {
        accountId: 'ACC-001',
        symbol: 'NVDA',
        status: 'OPEN',
      },
      conditionExpression: '#account = :accountId AND #status = :expectedStatus',
      expressionAttributeNames: {
        '#account': 'accountId',
      },
      expressionAttributeValues: {
        ':accountId': 'ACC-001',
        ':expectedStatus': 'PENDING',
      },
    });

    expect(command.ExpressionAttributeNames).toStrictEqual({
      '#account': 'accountId',
      '#status': 'status',
    });
  });

  it('rejects missing expression attribute values referenced by the condition', () => {
    expect(() =>
      build({
        tableName: 'orders',
        item: {
          id: 'order-001',
          status: 'CONFIRMED',
        },
        conditionExpression: '#status = :expectedStatus AND #version = :expectedVersion',
        expressionAttributeNames: {
          '#status': 'status',
          '#version': 'version',
        },
        expressionAttributeValues: {
          ':expectedStatus': 'PENDING',
        },
      })
    ).toThrow(/Missing expression attribute value.*:expectedVersion/);
  });

  it('preserves ReturnValuesOnConditionCheckFailure', () => {
    const command = build({
      tableName: 'orders',
      item: {
        id: 'order-001',
        status: 'CONFIRMED',
        version: 8,
      },
      conditionExpression: '#version = :expectedVersion',
      expressionAttributeValues: {
        ':expectedVersion': 7,
      },
      returnValuesOnConditionCheckFailure: 'ALL_OLD',
    });

    expect(command.ReturnValuesOnConditionCheckFailure).toBe('ALL_OLD');
    expect(command.ExpressionAttributeNames).toStrictEqual({
      '#version': 'version',
    });
  });

  it('allows caller-provided aliases to map expression tokens to different attribute names', () => {
    const command = build({
      tableName: 'positions',
      item: {
        accountId: 'ACC-001',
        symbol: 'NVDA',
        status: 'OPEN',
        version: 11,
      },
      conditionExpression: '#status = :expectedStatus AND #account = :accountId AND #version = :expectedVersion',
      expressionAttributeNames: {
        '#account': 'accountId',
      },
      expressionAttributeValues: {
        ':expectedStatus': 'OPEN',
        ':accountId': 'ACC-001',
        ':expectedVersion': 10,
      },
    });

    expect(command.ExpressionAttributeNames).toStrictEqual({
      '#status': 'status',
      '#account': 'accountId',
      '#version': 'version',
    });
  });

  it('omits empty expression maps when the condition does not require aliases or values', () => {
    const command = build({
      tableName: 'users',
      item: {
        id: 'user-001',
      },
      conditionExpression: 'attribute_exists(id)',
      expressionAttributeNames: {},
      expressionAttributeValues: {},
    });

    expect(command).not.toHaveProperty('ExpressionAttributeNames');
    expect(command).not.toHaveProperty('ExpressionAttributeValues');
  });

  it.each([
    [
      'empty table name',
      {
        tableName: '   ',
        item: { id: 'user-001' },
      },
    ],
    [
      'invalid item',
      {
        tableName: 'users',
        item: 'user-001',
      },
    ],
    [
      'unsupported return value',
      {
        tableName: 'users',
        item: { id: 'user-001' },
        returnValues: 'ALL_NEW',
      },
    ],
    [
      'expression names without a condition',
      {
        tableName: 'users',
        item: { id: 'user-001' },
        expressionAttributeNames: {
          '#status': 'status',
        },
      },
    ],
    [
      'expression values without a condition',
      {
        tableName: 'users',
        item: { id: 'user-001' },
        expressionAttributeValues: {
          ':status': 'ACTIVE',
        },
      },
    ],
  ])('rejects %s', (_description, input) => {
    expect(() => build(input)).toThrow();
  });
});
