import { describe, expect, it } from 'vitest';

import { customBatchGetCmdInputSch } from '../../types/command-input.types';
import { buildValidatedBatchGetCommand } from '../batch-get-command';

function build(input: unknown) {
  return buildValidatedBatchGetCommand(customBatchGetCmdInputSch.parse(input));
}

describe('buildValidatedBatchGetCommand', () => {
  it('builds a command for one table with one simple string partition key', () => {
    expect(
      build({
        tables: [{ tableName: 'Users', keys: [{ userId: 'user-1' }] }],
      })
    ).toEqual({
      RequestItems: {
        Users: {
          Keys: [{ userId: { S: 'user-1' } }],
          ConsistentRead: false,
        },
      },
      ReturnConsumedCapacity: 'NONE',
    });
  });

  it('builds a command for one table with multiple keys', () => {
    const command = build({
      tables: [{ tableName: 'Users', keys: [{ userId: 'user-1' }, { userId: 'user-2' }] }],
    });

    expect(command.RequestItems?.Users?.Keys).toEqual([{ userId: { S: 'user-1' } }, { userId: { S: 'user-2' } }]);
  });

  it('builds a command for multiple tables', () => {
    const command = build({
      tables: [
        { tableName: 'Users', keys: [{ userId: 'user-1' }] },
        { tableName: 'Orders', keys: [{ orderId: 42 }] },
      ],
    });

    expect(command.RequestItems).toEqual({
      Users: {
        Keys: [{ userId: { S: 'user-1' } }],
        ConsistentRead: false,
      },
      Orders: {
        Keys: [{ orderId: { N: '42' } }],
        ConsistentRead: false,
      },
    });
  });

  it('supports a composite partition key and sort key', () => {
    const command = build({
      tables: [
        {
          tableName: 'Orders',
          keys: [{ customerId: 'customer-1', orderNumber: 7 }],
        },
      ],
    });

    expect(command.RequestItems?.Orders?.Keys).toEqual([
      {
        customerId: { S: 'customer-1' },
        orderNumber: { N: '7' },
      },
    ]);
  });

  it('converts string and numeric key values to DynamoDB attributes', () => {
    const command = build({
      tables: [{ tableName: 'Orders', keys: [{ tenant: 'acme', sequence: -12 }] }],
    });

    expect(command.RequestItems?.Orders?.Keys?.[0]).toEqual({
      tenant: { S: 'acme' },
      sequence: { N: '-12' },
    });
  });

  it('defaults consistentRead to false independently for each table', () => {
    const command = build({
      tables: [
        { tableName: 'Users', keys: [{ id: 'user-1' }] },
        { tableName: 'Orders', keys: [{ id: 'order-1' }], consistentRead: true },
      ],
    });

    expect(command.RequestItems?.Users?.ConsistentRead).toBe(false);
    expect(command.RequestItems?.Orders?.ConsistentRead).toBe(true);
  });

  it('defaults returnConsumedCapacity to NONE', () => {
    expect(build({ tables: [{ tableName: 'Users', keys: [{ id: 'user-1' }] }] }).ReturnConsumedCapacity).toBe('NONE');
  });

  it.each(['TOTAL', 'INDEXES'] as const)('preserves returnConsumedCapacity %s', (returnConsumedCapacity) => {
    const command = build({
      tables: [{ tableName: 'Users', keys: [{ id: 'user-1' }] }],
      returnConsumedCapacity,
    });

    expect(command.ReturnConsumedCapacity).toBe(returnConsumedCapacity);
  });

  it('builds projection aliases and automatically includes key attributes', () => {
    const command = build({
      tables: [
        {
          tableName: 'Orders',
          keys: [{ orderId: 1, tenantId: 'tenant-1' }],
          attributes: ['status', 'total'],
        },
      ],
    });

    expect(command.RequestItems?.Orders).toEqual({
      Keys: [{ orderId: { N: '1' }, tenantId: { S: 'tenant-1' } }],
      ConsistentRead: false,
      ProjectionExpression: '#attr0, #attr1, #attr2, #attr3',
      ExpressionAttributeNames: {
        '#attr0': 'orderId',
        '#attr1': 'tenantId',
        '#attr2': 'status',
        '#attr3': 'total',
      },
    });
  });

  it('removes duplicate projected attributes, including repeated key attributes', () => {
    const command = build({
      tables: [
        {
          tableName: 'Users',
          keys: [{ id: 'user-1' }],
          attributes: ['name', 'id', 'name'],
        },
      ],
    });

    expect(command.RequestItems?.Users?.ProjectionExpression).toBe('#attr0, #attr1');
    expect(command.RequestItems?.Users?.ExpressionAttributeNames).toEqual({
      '#attr0': 'id',
      '#attr1': 'name',
    });
  });

  it('does not add projection properties when attributes is omitted', () => {
    const request = build({
      tables: [{ tableName: 'Users', keys: [{ id: 'user-1' }] }],
    }).RequestItems?.Users;

    expect(request).not.toHaveProperty('ProjectionExpression');
    expect(request).not.toHaveProperty('ExpressionAttributeNames');
  });

  it('rejects an empty tables array', () => {
    expect(() => customBatchGetCmdInputSch.parse({ tables: [] })).toThrow();
  });

  it('rejects a table with an empty keys array', () => {
    expect(() => customBatchGetCmdInputSch.parse({ tables: [{ tableName: 'Users', keys: [] }] })).toThrow();
  });

  it('rejects more than 100 total keys across all tables', () => {
    const users = Array.from({ length: 51 }, (_, id) => ({ id }));
    const orders = Array.from({ length: 50 }, (_, id) => ({ id }));

    expect(() =>
      customBatchGetCmdInputSch.parse({
        tables: [
          { tableName: 'Users', keys: users },
          { tableName: 'Orders', keys: orders },
        ],
      })
    ).toThrow('A BatchGetItem request supports at most 100 keys in total.');
  });

  it('rejects duplicate table names', () => {
    expect(() =>
      customBatchGetCmdInputSch.parse({
        tables: [
          { tableName: 'Users', keys: [{ id: 'user-1' }] },
          { tableName: 'Users', keys: [{ id: 'user-2' }] },
        ],
      })
    ).toThrow(/Duplicate table/);
  });

  it('rejects duplicate keys within the same table', () => {
    expect(() =>
      build({
        tables: [{ tableName: 'Users', keys: [{ id: 'user-1' }, { id: 'user-1' }] }],
      })
    ).toThrow('Duplicate key found for table "Users".');
  });

  it('rejects keys with inconsistent primary-key attribute names', () => {
    expect(() =>
      build({
        tables: [{ tableName: 'Users', keys: [{ userId: 'user-1' }, { id: 'user-2' }] }],
      })
    ).toThrow('does not have the same primary-key attributes as the other keys');
  });

  it('rejects inconsistent value types for the same key attribute', () => {
    expect(() =>
      build({
        tables: [{ tableName: 'Users', keys: [{ id: '1' }, { id: 2 }] }],
      })
    ).toThrow('Key attribute "id" has inconsistent value types in table "Users".');
  });

  it.each([
    ['zero', {}],
    ['more than two', { tenant: 'tenant-1', category: 'user', id: 'user-1' }],
  ])('rejects keys containing %s key attributes', (_description, key) => {
    expect(() => build({ tables: [{ tableName: 'Users', keys: [key] }] })).toThrow(
      'Keys for table "Users" must contain one or two attributes.'
    );
  });

  it.each([
    ['boolean', true],
    ['null', null],
    ['object', { value: 'user-1' }],
    ['array', ['user-1']],
  ])('rejects an unsupported %s key value', (_description, value) => {
    expect(() =>
      customBatchGetCmdInputSch.parse({
        tables: [{ tableName: 'Users', keys: [{ id: value }] }],
      })
    ).toThrow();
  });

  it.each([
    ['top-level', { tables: [{ tableName: 'Users', keys: [{ id: 'user-1' }] }], unexpected: true }],
    ['table-level', { tables: [{ tableName: 'Users', keys: [{ id: 'user-1' }], unexpected: true }] }],
  ])('rejects unknown %s properties because the schema is strict', (_description, input) => {
    expect(() => customBatchGetCmdInputSch.parse(input)).toThrow();
  });
});
