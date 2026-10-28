import { describe, expect, it } from 'vite-plus/test';

import { CustomTransactWriteCmdInput } from '../../types/command-input.types';
import { buildValidatedTransactWriteCommand } from '../transact-write-command';

function build(input: unknown) {
  return buildValidatedTransactWriteCommand(input as CustomTransactWriteCmdInput);
}

describe('buildValidatedTransactWriteCommand', () => {
  it('builds a realistic atomic transaction containing every supported operation', () => {
    const command = build({
      transactItems: [
        {
          operation: 'PUT',
          tableName: 'orders',
          item: {
            id: 'order-001',
            userId: 'user-001',
            status: 'PENDING',
            amount: 500,
          },
          conditionExpression: 'attribute_not_exists(#id)',
          expressionAttributeNames: { '#id': 'id' },
        },
        {
          operation: 'UPDATE',
          tableName: 'accounts',
          key: { id: 'account-001' },
          updateExpression: 'SET #balance = #balance - :amount, #updatedAt = :updatedAt',
          conditionExpression: '#status = :activeStatus AND #balance >= :amount',
          expressionAttributeNames: {
            '#balance': 'balance',
            '#status': 'status',
            '#updatedAt': 'updatedAt',
          },
          expressionAttributeValues: {
            ':amount': 500,
            ':activeStatus': 'ACTIVE',
            ':updatedAt': '2026-10-16T14:00:00.000Z',
          },
          returnValuesOnConditionCheckFailure: 'ALL_OLD',
        },
        {
          operation: 'DELETE',
          tableName: 'pending-orders',
          key: { id: 'pending-001' },
        },
        {
          operation: 'CONDITION_CHECK',
          tableName: 'users',
          key: { id: 'user-001' },
          conditionExpression: '#status = :requiredStatus',
          expressionAttributeNames: { '#status': 'status' },
          expressionAttributeValues: { ':requiredStatus': 'ACTIVE' },
        },
      ],
    });

    expect(command).toStrictEqual({
      TransactItems: [
        {
          Put: {
            TableName: 'orders',
            Item: {
              id: 'order-001',
              userId: 'user-001',
              status: 'PENDING',
              amount: 500,
            },
            ConditionExpression: 'attribute_not_exists(#id)',
            ExpressionAttributeNames: { '#id': 'id' },
            ReturnValuesOnConditionCheckFailure: 'NONE',
          },
        },
        {
          Update: {
            TableName: 'accounts',
            Key: { id: 'account-001' },
            UpdateExpression: 'SET #balance = #balance - :amount, #updatedAt = :updatedAt',
            ConditionExpression: '#status = :activeStatus AND #balance >= :amount',
            ExpressionAttributeNames: {
              '#balance': 'balance',
              '#updatedAt': 'updatedAt',
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':amount': 500,
              ':activeStatus': 'ACTIVE',
              ':updatedAt': '2026-10-16T14:00:00.000Z',
            },
            ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
          },
        },
        {
          Delete: {
            TableName: 'pending-orders',
            Key: { id: 'pending-001' },
            ReturnValuesOnConditionCheckFailure: 'NONE',
          },
        },
        {
          ConditionCheck: {
            TableName: 'users',
            Key: { id: 'user-001' },
            ConditionExpression: '#status = :requiredStatus',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':requiredStatus': 'ACTIVE' },
            ReturnValuesOnConditionCheckFailure: 'NONE',
          },
        },
      ],
      ReturnConsumedCapacity: 'NONE',
      ReturnItemCollectionMetrics: 'NONE',
    });
  });

  it('preserves a nested PUT item as native JavaScript values', () => {
    const item = {
      id: 'order-001',
      active: true,
      amount: 1250.75,
      metadata: {
        source: 'API',
        device: {
          platform: 'iOS',
          version: '26.0',
        },
      },
      tags: ['priority', 'manual-review'],
      lines: [{ symbol: 'NVDA', quantity: 5 }],
      nullableField: null,
    };

    const command = build({
      transactItems: [{ operation: 'PUT', tableName: 'orders', item }],
    });

    expect(command.TransactItems?.[0]?.Put?.Item).toStrictEqual(item);
  });

  it('builds a create-only PUT condition', () => {
    const command = build({
      transactItems: [
        {
          operation: 'PUT',
          tableName: 'orders',
          item: { id: 'order-001', status: 'PENDING' },
          conditionExpression: 'attribute_not_exists(#id)',
          expressionAttributeNames: { '#id': 'id' },
        },
      ],
    });

    expect(command.TransactItems?.[0]?.Put).toStrictEqual({
      TableName: 'orders',
      Item: { id: 'order-001', status: 'PENDING' },
      ConditionExpression: 'attribute_not_exists(#id)',
      ExpressionAttributeNames: { '#id': 'id' },
      ReturnValuesOnConditionCheckFailure: 'NONE',
    });
  });

  it('builds a conditional account balance UPDATE with aliases and native values', () => {
    const command = build({
      transactItems: [
        {
          operation: 'UPDATE',
          tableName: 'accounts',
          key: { id: 'account-001' },
          updateExpression: 'SET #balance = #balance - :amount, #updatedAt = :updatedAt',
          conditionExpression: '#status = :activeStatus AND #balance >= :amount',
          expressionAttributeNames: {
            '#balance': 'balance',
            '#updatedAt': 'updatedAt',
            '#status': 'status',
          },
          expressionAttributeValues: {
            ':amount': 500,
            ':updatedAt': '2026-10-16T14:00:00.000Z',
            ':activeStatus': 'ACTIVE',
          },
          returnValuesOnConditionCheckFailure: 'ALL_OLD',
        },
      ],
    });

    expect(command.TransactItems?.[0]?.Update).toStrictEqual({
      TableName: 'accounts',
      Key: { id: 'account-001' },
      UpdateExpression: 'SET #balance = #balance - :amount, #updatedAt = :updatedAt',
      ConditionExpression: '#status = :activeStatus AND #balance >= :amount',
      ExpressionAttributeNames: {
        '#balance': 'balance',
        '#updatedAt': 'updatedAt',
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':amount': 500,
        ':updatedAt': '2026-10-16T14:00:00.000Z',
        ':activeStatus': 'ACTIVE',
      },
      ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
    });
  });

  it('allows an UPDATE to use aliases and values without a condition', () => {
    const command = build({
      transactItems: [
        {
          operation: 'UPDATE',
          tableName: 'users',
          key: { id: 'user-001' },
          updateExpression: 'SET #status = :status',
          expressionAttributeNames: { '#status': 'status' },
          expressionAttributeValues: { ':status': 'ACTIVE' },
        },
      ],
    });

    expect(command.TransactItems?.[0]?.Update).toStrictEqual({
      TableName: 'users',
      Key: { id: 'user-001' },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'ACTIVE' },
      ReturnValuesOnConditionCheckFailure: 'NONE',
    });
  });

  it('builds a conditional DELETE with a partition and sort key', () => {
    const command = build({
      transactItems: [
        {
          operation: 'DELETE',
          tableName: 'orders',
          key: { accountId: 'account-001', orderId: 'order-001' },
          conditionExpression: '#status = :expectedStatus',
          expressionAttributeNames: { '#status': 'status' },
          expressionAttributeValues: { ':expectedStatus': 'CANCELLED' },
        },
      ],
    });

    expect(command.TransactItems?.[0]?.Delete).toStrictEqual({
      TableName: 'orders',
      Key: { accountId: 'account-001', orderId: 'order-001' },
      ConditionExpression: '#status = :expectedStatus',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':expectedStatus': 'CANCELLED' },
      ReturnValuesOnConditionCheckFailure: 'NONE',
    });
  });

  it('builds an optimistic-locking CONDITION_CHECK', () => {
    const command = build({
      transactItems: [
        {
          operation: 'CONDITION_CHECK',
          tableName: 'users',
          key: { id: 'user-001' },
          conditionExpression: '#status = :requiredStatus AND #version = :expectedVersion',
          expressionAttributeNames: { '#status': 'status', '#version': 'version' },
          expressionAttributeValues: { ':requiredStatus': 'ACTIVE', ':expectedVersion': 7 },
        },
      ],
    });

    expect(command.TransactItems?.[0]?.ConditionCheck).toStrictEqual({
      TableName: 'users',
      Key: { id: 'user-001' },
      ConditionExpression: '#status = :requiredStatus AND #version = :expectedVersion',
      ExpressionAttributeNames: { '#status': 'status', '#version': 'version' },
      ExpressionAttributeValues: { ':requiredStatus': 'ACTIVE', ':expectedVersion': 7 },
      ReturnValuesOnConditionCheckFailure: 'NONE',
    });
  });

  it('allows caller-provided aliases to override generated shorthand mappings', () => {
    const command = build({
      transactItems: [
        {
          operation: 'CONDITION_CHECK',
          tableName: 'accounts',
          key: { id: 'account-001' },
          conditionExpression: '#account = :accountId',
          expressionAttributeNames: { '#account': 'accountId' },
          expressionAttributeValues: { ':accountId': 'account-001' },
        },
      ],
    });

    expect(command.TransactItems?.[0]?.ConditionCheck?.ExpressionAttributeNames).toStrictEqual({
      '#account': 'accountId',
    });
  });

  it('preserves transaction-level options', () => {
    const command = build({
      transactItems: [{ operation: 'DELETE', tableName: 'sessions', key: { id: 'session-001' } }],
      clientRequestToken: 'checkout-user-001-order-001',
      returnConsumedCapacity: 'TOTAL',
      returnItemCollectionMetrics: 'SIZE',
    });

    expect(command.ClientRequestToken).toBe('checkout-user-001-order-001');
    expect(command.ReturnConsumedCapacity).toBe('TOTAL');
    expect(command.ReturnItemCollectionMetrics).toBe('SIZE');
  });

  it.each([
    ['an empty transaction', { transactItems: [] }],
    [
      'more than 100 operations',
      {
        transactItems: Array.from({ length: 101 }, (_, index) => ({
          operation: 'DELETE',
          tableName: 'sessions',
          key: { id: `session-${index}` },
        })),
      },
    ],
    ['an invalid operation', { transactItems: [{ operation: 'GET', tableName: 'users', key: { id: 'user-001' } }] }],
    ['an empty table name', { transactItems: [{ operation: 'DELETE', tableName: '   ', key: { id: 'user-001' } }] }],
    ['an invalid PUT item', { transactItems: [{ operation: 'PUT', tableName: 'users', item: 'user-001' }] }],
    ['an invalid DELETE key', { transactItems: [{ operation: 'DELETE', tableName: 'users', key: 'user-001' }] }],
    [
      'an UPDATE without an update expression',
      { transactItems: [{ operation: 'UPDATE', tableName: 'users', key: { id: 'user-001' } }] },
    ],
    [
      'a CONDITION_CHECK without a condition expression',
      { transactItems: [{ operation: 'CONDITION_CHECK', tableName: 'users', key: { id: 'user-001' } }] },
    ],
    [
      'an unsupported failure return value',
      {
        transactItems: [
          {
            operation: 'DELETE',
            tableName: 'users',
            key: { id: 'user-001' },
            returnValuesOnConditionCheckFailure: 'ALL_NEW',
          },
        ],
      },
    ],
    [
      'an unknown operation field',
      {
        transactItems: [{ operation: 'DELETE', tableName: 'users', key: { id: 'user-001' }, unexpected: true }],
      },
    ],
    [
      'PUT expression names without a condition',
      {
        transactItems: [
          {
            operation: 'PUT',
            tableName: 'users',
            item: { id: 'user-001' },
            expressionAttributeNames: { '#status': 'status' },
          },
        ],
      },
    ],
    [
      'DELETE expression values without a condition',
      {
        transactItems: [
          {
            operation: 'DELETE',
            tableName: 'users',
            key: { id: 'user-001' },
            expressionAttributeValues: { ':status': 'INACTIVE' },
          },
        ],
      },
    ],
  ])('rejects %s', (_description, input) => {
    expect(() => build(input)).toThrow();
  });

  it.each([
    ['zero', {}],
    ['more than two', { tenantId: 'tenant-001', entity: 'USER', id: 'user-001' }],
  ])('rejects keys containing %s attributes', (_description, key) => {
    expect(() =>
      build({
        transactItems: [{ operation: 'DELETE', tableName: 'users', key }],
      })
    ).toThrow('Key must contain a partition key and optional sort key.');
  });
});
