import { describe, expect, it } from 'vitest';

import { customGetCmdInputSch } from '../../types/command-input.types';
import { buildValidatedGetCommand } from '../get-command';

function build(input: unknown) {
  return buildValidatedGetCommand(customGetCmdInputSch.parse(input));
}

describe('buildValidatedGetCommand', () => {
  it('builds a command with a simple string partition key and default options', () => {
    expect(build({ tableName: 'Users', key: { userId: 'user-1' } })).toEqual({
      TableName: 'Users',
      Key: { userId: { S: 'user-1' } },
      ConsistentRead: false,
      ReturnConsumedCapacity: undefined,
    });
  });

  it('supports a composite partition key and numeric sort key', () => {
    expect(build({ tableName: 'Orders', key: { customerId: 'customer-1', orderNumber: 7 } }).Key).toEqual({
      customerId: { S: 'customer-1' },
      orderNumber: { N: '7' },
    });
  });

  it('converts a numeric partition key to a DynamoDB attribute', () => {
    expect(build({ tableName: 'Orders', key: { orderId: 42 } }).Key).toEqual({ orderId: { N: '42' } });
  });

  it('supports decimal, bigint, and binary key values', () => {
    expect(
      build({
        tableName: 'Events',
        key: { decimalId: 12.5, binaryId: new Uint8Array([1, 2]) },
      }).Key
    ).toEqual({
      decimalId: { N: '12.5' },
      binaryId: { B: new Uint8Array([1, 2]) },
    });

    expect(build({ tableName: 'Accounts', key: { accountId: 9007199254740993n } }).Key).toEqual({
      accountId: { N: '9007199254740993' },
    });
  });

  it.each([true, false])('preserves consistentRead %s', (consistentRead) => {
    expect(build({ tableName: 'Users', key: { id: 'user-1' }, consistentRead }).ConsistentRead).toBe(consistentRead);
  });

  it.each(['NONE', 'TOTAL', 'INDEXES'] as const)('preserves returnConsumedCapacity %s', (returnConsumedCapacity) => {
    expect(build({ tableName: 'Users', key: { id: 'user-1' }, returnConsumedCapacity }).ReturnConsumedCapacity).toBe(
      returnConsumedCapacity
    );
  });

  it('builds projection aliases for requested attributes', () => {
    const command = build({ tableName: 'Users', key: { id: 'user-1' }, attributes: ['name', 'status'] });

    expect(command.ProjectionExpression).toBe('#attr0, #attr1');
    expect(command.ExpressionAttributeNames).toEqual({ '#attr0': 'name', '#attr1': 'status' });
  });

  it('builds aliases for nested attributes and list indexes', () => {
    const command = build({
      tableName: 'Users',
      key: { id: 'user-1' },
      attributes: ['profile.name', 'profile.email', 'orders[0].id'],
    });

    expect(command.ProjectionExpression).toBe('#attr0.#attr1, #attr0.#attr2, #attr3[0].#attr4');
    expect(command.ExpressionAttributeNames).toEqual({
      '#attr0': 'profile',
      '#attr1': 'name',
      '#attr2': 'email',
      '#attr3': 'orders',
      '#attr4': 'id',
    });
  });

  it('passes through a raw projection expression and its aliases', () => {
    const command = build({
      tableName: 'Users',
      key: { id: 'user-1' },
      projectionExpression: '#profile.#name, #status',
      expressionAttributeNames: { '#profile': 'profile', '#name': 'name', '#status': 'status' },
    });

    expect(command.ProjectionExpression).toBe('#profile.#name, #status');
    expect(command.ExpressionAttributeNames).toEqual({ '#profile': 'profile', '#name': 'name', '#status': 'status' });
  });

  it('aliases reserved keywords in raw projection paths', () => {
    const command = build({
      tableName: 'Users',
      key: { id: 'user-1' },
      projectionExpression: 'status, profile.size, items[0].order',
    });

    expect(command.ProjectionExpression).toBe('#status, profile.#size, #items[0].#order');
    expect(command.ExpressionAttributeNames).toEqual({
      '#status': 'status',
      '#size': 'size',
      '#items': 'items',
      '#order': 'order',
    });
  });

  it('merges raw projection expressions with structured attributes', () => {
    const command = build({
      tableName: 'Users',
      key: { id: 'user-1' },
      projectionExpression: '#status',
      expressionAttributeNames: { '#status': 'status' },
      attributes: ['profile.name', 'email'],
    });

    expect(command.ProjectionExpression).toBe('#status, #attr0.#attr1, #attr2');
    expect(command.ExpressionAttributeNames).toEqual({
      '#status': 'status',
      '#attr0': 'profile',
      '#attr1': 'name',
      '#attr2': 'email',
    });
  });

  it.each([undefined, '', null])('omits projection properties for an empty projection %s', (projectionExpression) => {
    const command = build({ tableName: 'Users', key: { id: 'user-1' }, projectionExpression });

    expect(command).not.toHaveProperty('ProjectionExpression');
    expect(command).not.toHaveProperty('ExpressionAttributeNames');
  });

  it.each([
    ['missing table name', { key: { id: 'user-1' } }],
    ['empty table name', { tableName: '', key: { id: 'user-1' } }],
    ['missing key', { tableName: 'Users' }],
    ['empty key', { tableName: 'Users', key: {} }],
    ['too many key attributes', { tableName: 'Users', key: { tenant: 'acme', type: 'user', id: 'user-1' } }],
    ['invalid key', { tableName: 'Users', key: 'user-1' }],
    ['boolean key value', { tableName: 'Users', key: { id: true } }],
    ['null key value', { tableName: 'Users', key: { id: null } }],
    ['empty binary key value', { tableName: 'Users', key: { id: new Uint8Array() } }],
    ['empty attributes', { tableName: 'Users', key: { id: 'user-1' }, attributes: [] }],
    ['empty attribute name', { tableName: 'Users', key: { id: 'user-1' }, attributes: [''] }],
    ['invalid projection path', { tableName: 'Users', key: { id: 'user-1' }, attributes: ['profile..name'] }],
    [
      'aliases without raw projection expression',
      { tableName: 'Users', key: { id: 'user-1' }, expressionAttributeNames: { '#status': 'status' } },
    ],
    ['invalid consistency option', { tableName: 'Users', key: { id: 'user-1' }, consistentRead: 'true' }],
    ['invalid capacity option', { tableName: 'Users', key: { id: 'user-1' }, returnConsumedCapacity: 'INVALID' }],
  ])('rejects %s', (_description, input) => {
    expect(() => build(input)).toThrow();
  });

  it('rejects unsupported key values during input validation', () => {
    expect(() => build({ tableName: 'Users', key: { id: undefined } })).toThrow();
  });
});
