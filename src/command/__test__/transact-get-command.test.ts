import { describe, expect, it } from 'vite-plus/test';

import { CustomTransactGetCmdInput } from '../../types/command-input.types';
import { buildValidatedTransactGetCommand } from '../transact-get-command';

function build(input: unknown) {
  return buildValidatedTransactGetCommand(input as CustomTransactGetCmdInput);
}

describe('buildValidatedTransactGetCommand', () => {
  it('builds a realistic ordered multi-table transaction', () => {
    const command = build({
      transactItems: [
        {
          tableName: 'users',
          key: { id: 'user-001' },
        },
        {
          tableName: 'accounts',
          key: { accountId: 'ACC-001', type: 'TRADING' },
          projectionExpression: '#status, balance, currency, updatedAt',
          expressionAttributeNames: { '#status': 'status' },
        },
        {
          tableName: 'orders',
          key: { id: 'order-001' },
          projectionExpression: '#status, amount, createdAt',
          expressionAttributeNames: { '#status': 'status' },
        },
      ],
      returnConsumedCapacity: 'TOTAL',
    });

    expect(command).toStrictEqual({
      TransactItems: [
        {
          Get: {
            TableName: 'users',
            Key: { id: 'user-001' },
          },
        },
        {
          Get: {
            TableName: 'accounts',
            Key: { accountId: 'ACC-001', type: 'TRADING' },
            ProjectionExpression: '#status, balance, currency, updatedAt',
            ExpressionAttributeNames: { '#status': 'status' },
          },
        },
        {
          Get: {
            TableName: 'orders',
            Key: { id: 'order-001' },
            ProjectionExpression: '#status, amount, createdAt',
            ExpressionAttributeNames: { '#status': 'status' },
          },
        },
      ],
      ReturnConsumedCapacity: 'TOTAL',
    });
  });

  it('preserves a partition-only key as a native JavaScript value', () => {
    const command = build({
      transactItems: [{ tableName: 'users', key: { id: 'user-001' } }],
    });

    expect(command.TransactItems?.[0]?.Get?.Key).toStrictEqual({ id: 'user-001' });
  });

  it('preserves both attributes of a composite primary key', () => {
    const command = build({
      transactItems: [
        {
          tableName: 'positions',
          key: { accountId: 'ACC-001', symbol: 'NVDA' },
        },
      ],
    });

    expect(command.TransactItems?.[0]?.Get?.Key).toStrictEqual({
      accountId: 'ACC-001',
      symbol: 'NVDA',
    });
  });

  it('preserves native string and numeric key values for the DocumentClient', () => {
    const command = build({
      transactItems: [
        {
          tableName: 'account-versions',
          key: { accountId: 'ACC-001', version: 12 },
        },
      ],
    });

    expect(command.TransactItems?.[0]?.Get?.Key).toStrictEqual({
      accountId: 'ACC-001',
      version: 12,
    });
    expect(command.TransactItems?.[0]?.Get?.Key).not.toStrictEqual({
      accountId: { S: 'ACC-001' },
      version: { N: '12' },
    });
  });

  it('passes through a projection expression with reserved-word aliases', () => {
    const command = build({
      transactItems: [
        {
          tableName: 'users',
          key: { id: 'user-001' },
          projectionExpression: '#status, #name, createdAt, metadata.owner',
          expressionAttributeNames: {
            '#status': 'status',
            '#name': 'name',
          },
        },
      ],
    });

    expect(command.TransactItems?.[0]?.Get).toStrictEqual({
      TableName: 'users',
      Key: { id: 'user-001' },
      ProjectionExpression: '#status, #name, createdAt, metadata.owner',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#name': 'name',
      },
    });
  });

  it('preserves nested document paths in a projection expression', () => {
    const command = build({
      transactItems: [
        {
          tableName: 'users',
          key: { id: 'user-001' },
          projectionExpression: 'profile.#name, preferences.language, positions[0].symbol',
          expressionAttributeNames: { '#name': 'name' },
        },
      ],
    });

    expect(command.TransactItems?.[0]?.Get?.ProjectionExpression).toBe(
      'profile.#name, preferences.language, positions[0].symbol'
    );
    expect(command.TransactItems?.[0]?.Get?.ExpressionAttributeNames).toStrictEqual({ '#name': 'name' });
  });

  it('keeps projection aliases scoped to their transaction item', () => {
    const command = build({
      transactItems: [
        {
          tableName: 'users',
          key: { id: 'user-001' },
          projectionExpression: '#name, email',
          expressionAttributeNames: { '#name': 'name' },
        },
        {
          tableName: 'accounts',
          key: { id: 'account-001' },
          projectionExpression: '#status, balance',
          expressionAttributeNames: { '#status': 'status' },
        },
      ],
    });

    expect(command.TransactItems?.[0]?.Get?.ExpressionAttributeNames).toStrictEqual({ '#name': 'name' });
    expect(command.TransactItems?.[1]?.Get?.ExpressionAttributeNames).toStrictEqual({ '#status': 'status' });
  });

  it('omits projection properties when no projection is requested', () => {
    const get = build({
      transactItems: [{ tableName: 'users', key: { id: 'user-001' } }],
    }).TransactItems?.[0]?.Get;

    expect(get).not.toHaveProperty('ProjectionExpression');
    expect(get).not.toHaveProperty('ExpressionAttributeNames');
  });

  it('omits an empty expressionAttributeNames map', () => {
    const get = build({
      transactItems: [
        {
          tableName: 'users',
          key: { id: 'user-001' },
          projectionExpression: 'email, createdAt',
          expressionAttributeNames: {},
        },
      ],
    }).TransactItems?.[0]?.Get;

    expect(get?.ProjectionExpression).toBe('email, createdAt');
    expect(get).not.toHaveProperty('ExpressionAttributeNames');
  });

  it('defaults returnConsumedCapacity to NONE and preserves an explicit option', () => {
    expect(build({ transactItems: [{ tableName: 'users', key: { id: 'user-001' } }] }).ReturnConsumedCapacity).toBe(
      'NONE'
    );

    expect(
      build({
        transactItems: [{ tableName: 'users', key: { id: 'user-001' } }],
        returnConsumedCapacity: 'TOTAL',
      }).ReturnConsumedCapacity
    ).toBe('TOTAL');
  });

  it.each([1, 100])('accepts a transaction containing exactly %i item(s)', (length) => {
    const transactItems = Array.from({ length }, (_, index) => ({
      tableName: 'users',
      key: { id: `user-${index}` },
    }));

    expect(build({ transactItems }).TransactItems).toHaveLength(length);
  });

  it.each([0, 101])('rejects a transaction containing %i items', (length) => {
    const transactItems = Array.from({ length }, (_, index) => ({
      tableName: 'users',
      key: { id: `user-${index}` },
    }));

    expect(() => build({ transactItems })).toThrow();
  });

  it.each([
    ['one', { id: 'user-001' }],
    ['two', { accountId: 'ACC-001', symbol: 'NVDA' }],
  ])('accepts a key containing %s attribute(s)', (_description, key) => {
    expect(
      build({
        transactItems: [{ tableName: 'users', key }],
      }).TransactItems?.[0]?.Get?.Key
    ).toStrictEqual(key);
  });

  it.each([
    ['zero', {}],
    ['three', { tenantId: 'tenant-001', accountId: 'ACC-001', symbol: 'NVDA' }],
  ])('rejects a key containing %s attributes', (_description, key) => {
    expect(() =>
      build({
        transactItems: [{ tableName: 'users', key }],
      })
    ).toThrow('Key must contain exactly 1 or 2 attributes.');
  });

  it('rejects a whitespace-only table name', () => {
    expect(() =>
      build({
        transactItems: [{ tableName: '   ', key: { id: 'user-001' } }],
      })
    ).toThrow();
  });

  it('rejects expression attribute names without a projection expression', () => {
    expect(() =>
      build({
        transactItems: [
          {
            tableName: 'users',
            key: { id: 'user-001' },
            expressionAttributeNames: { '#status': 'status' },
          },
        ],
      })
    ).toThrow('expressionAttributeNames requires projectionExpression.');
  });

  it.each([
    [
      'top-level',
      {
        transactItems: [{ tableName: 'users', key: { id: 'user-001' } }],
        filterExpression: '#status = :status',
      },
    ],
    [
      'transaction-item',
      {
        transactItems: [
          {
            tableName: 'users',
            key: { id: 'user-001' },
            filterExpression: '#status = :status',
          },
        ],
      },
    ],
  ])('rejects an unknown %s property because the schema is strict', (_description, input) => {
    expect(() => build(input)).toThrow();
  });
});
