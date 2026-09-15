import { describe, expect, it } from 'vitest';

import { customBatchWriteCmdInputSch } from '../../types/command-input.types';
import { buildValidatedBatchWriteCommandInput } from '../batch-write-command';

const deleteOperation = (userId: unknown) => ({ operation: 'DELETE', key: { userId } });

const usersTable = (operations: unknown[]) => ({
  tableName: 'Users',
  keySchema: { partitionKey: 'userId' },
  operations,
});

describe('buildValidatedBatchWriteCommandInput', () => {
  it('builds a put request for a table with a simple partition key', () => {
    expect(
      buildValidatedBatchWriteCommandInput({
        tables: [usersTable([{ operation: 'PUT', item: { userId: 'user-1', name: 'Ada' } }])],
      })
    ).toEqual({
      RequestItems: {
        Users: [{ PutRequest: { Item: { userId: { S: 'user-1' }, name: { S: 'Ada' } } } }],
      },
      ReturnConsumedCapacity: 'NONE',
      ReturnItemCollectionMetrics: 'NONE',
    });
  });

  it('builds a delete request and converts a numeric key', () => {
    const command = buildValidatedBatchWriteCommandInput({ tables: [usersTable([deleteOperation(42)])] });

    expect(command.RequestItems?.Users).toEqual([{ DeleteRequest: { Key: { userId: { N: '42' } } } }]);
  });

  it('builds multiple operations for one table in input order', () => {
    const command = buildValidatedBatchWriteCommandInput({
      tables: [
        usersTable([
          { operation: 'PUT', item: { userId: 'user-1', active: true } },
          { operation: 'PUT', item: { userId: 'user-2', active: false } },
          deleteOperation('user-3'),
        ]),
      ],
    });

    expect(command.RequestItems?.Users).toEqual([
      { PutRequest: { Item: { userId: { S: 'user-1' }, active: { BOOL: true } } } },
      { PutRequest: { Item: { userId: { S: 'user-2' }, active: { BOOL: false } } } },
      { DeleteRequest: { Key: { userId: { S: 'user-3' } } } },
    ]);
  });

  it('builds operations for multiple tables', () => {
    const command = buildValidatedBatchWriteCommandInput({
      tables: [
        usersTable([{ operation: 'PUT', item: { userId: 'user-1' } }]),
        {
          tableName: 'Orders',
          keySchema: { partitionKey: 'orderId' },
          operations: [{ operation: 'DELETE', key: { orderId: 7 } }],
        },
      ],
    });

    expect(command.RequestItems).toEqual({
      Users: [{ PutRequest: { Item: { userId: { S: 'user-1' } } } }],
      Orders: [{ DeleteRequest: { Key: { orderId: { N: '7' } } } }],
    });
  });

  it('supports a composite partition key and sort key', () => {
    const command = buildValidatedBatchWriteCommandInput({
      tables: [
        {
          tableName: 'Orders',
          keySchema: { partitionKey: 'accountId', sortKey: 'orderId' },
          operations: [{ operation: 'DELETE', key: { accountId: 'account-1', orderId: 42 } }],
        },
      ],
    });

    expect(command.RequestItems?.Orders?.[0]).toEqual({
      DeleteRequest: { Key: { accountId: { S: 'account-1' }, orderId: { N: '42' } } },
    });
  });

  it('marshalls supported scalar, list, and map values in put items', () => {
    const command = buildValidatedBatchWriteCommandInput({
      tables: [
        usersTable([
          {
            operation: 'PUT',
            item: {
              userId: 'user-1',
              score: 12.5,
              active: true,
              deletedAt: null,
              tags: ['admin', 2],
              profile: { city: 'Ulaanbaatar', verified: false },
            },
          },
        ]),
      ],
    });

    expect(command.RequestItems?.Users?.[0]?.PutRequest?.Item).toEqual({
      userId: { S: 'user-1' },
      score: { N: '12.5' },
      active: { BOOL: true },
      deletedAt: { NULL: true },
      tags: { L: [{ S: 'admin' }, { N: '2' }] },
      profile: { M: { city: { S: 'Ulaanbaatar' }, verified: { BOOL: false } } },
    });
  });

  it('allows non-key attributes on put items', () => {
    const command = buildValidatedBatchWriteCommandInput({
      tables: [usersTable([{ operation: 'PUT', item: { userId: 'user-1', name: 'Ada' } }])],
    });

    expect(command.RequestItems?.Users?.[0]?.PutRequest?.Item).toHaveProperty('name', { S: 'Ada' });
  });

  it('applies default response options', () => {
    const command = buildValidatedBatchWriteCommandInput({ tables: [usersTable([deleteOperation('user-1')])] });

    expect(command.ReturnConsumedCapacity).toBe('NONE');
    expect(command.ReturnItemCollectionMetrics).toBe('NONE');
  });

  it.each(['TOTAL', 'INDEXES'] as const)('preserves returnConsumedCapacity %s', (returnConsumedCapacity) => {
    const command = buildValidatedBatchWriteCommandInput({
      tables: [usersTable([deleteOperation('user-1')])],
      returnConsumedCapacity,
    });

    expect(command.ReturnConsumedCapacity).toBe(returnConsumedCapacity);
  });

  it('preserves returnItemCollectionMetrics SIZE', () => {
    const command = buildValidatedBatchWriteCommandInput({
      tables: [usersTable([deleteOperation('user-1')])],
      returnItemCollectionMetrics: 'SIZE',
    });

    expect(command.ReturnItemCollectionMetrics).toBe('SIZE');
  });

  it('rejects an empty tables array', () => {
    expect(() => customBatchWriteCmdInputSch.parse({ tables: [] })).toThrow();
  });

  it('rejects a table with an empty operations array', () => {
    expect(() => customBatchWriteCmdInputSch.parse({ tables: [usersTable([])] })).toThrow();
  });

  it('rejects more than 25 total operations across tables', () => {
    const users = Array.from({ length: 13 }, (_, index) => deleteOperation(`user-${index}`));
    const orders = Array.from({ length: 13 }, (_, index) => ({
      operation: 'DELETE',
      key: { orderId: `order-${index}` },
    }));

    expect(() =>
      customBatchWriteCmdInputSch.parse({
        tables: [
          usersTable(users),
          { tableName: 'Orders', keySchema: { partitionKey: 'orderId' }, operations: orders },
        ],
      })
    ).toThrow('A BatchWriteItem request supports at most 25 operations in total.');
  });

  it('rejects duplicate table names', () => {
    expect(() =>
      customBatchWriteCmdInputSch.parse({
        tables: [usersTable([deleteOperation('user-1')]), usersTable([deleteOperation('user-2')])],
      })
    ).toThrow(/Duplicate table/);
  });

  it.each([
    [
      'two puts',
      [
        { operation: 'PUT', item: { userId: 'user-1', name: 'First' } },
        { operation: 'PUT', item: { userId: 'user-1', name: 'Second' } },
      ],
    ],
    ['a put and delete', [{ operation: 'PUT', item: { userId: 'user-1' } }, deleteOperation('user-1')]],
    ['two deletes', [deleteOperation('user-1'), deleteOperation('user-1')]],
  ])('rejects %s targeting the same item', (_description, operations) => {
    expect(() => buildValidatedBatchWriteCommandInput({ tables: [usersTable(operations)] })).toThrow(
      'Multiple operations target the same item in table "Users".'
    );
  });

  it.each([
    ['put', { operation: 'PUT', item: { name: 'Ada' } }, 'Missing or invalid primary-key attribute "userId".'],
    ['delete', { operation: 'DELETE', key: { name: 'Ada' } }, 'Delete key must contain exactly: userId.'],
  ])('rejects a %s operation missing its partition key', (_description, operation, expectedMessage) => {
    expect(() => buildValidatedBatchWriteCommandInput({ tables: [usersTable([operation])] })).toThrow(expectedMessage);
  });

  it('rejects an operation missing its required sort key', () => {
    expect(() =>
      buildValidatedBatchWriteCommandInput({
        tables: [
          {
            tableName: 'Orders',
            keySchema: { partitionKey: 'accountId', sortKey: 'orderId' },
            operations: [{ operation: 'PUT', item: { accountId: 'account-1' } }],
          },
        ],
      })
    ).toThrow('Missing or invalid primary-key attribute "orderId".');
  });

  it('rejects extra attributes in a delete key', () => {
    expect(() =>
      buildValidatedBatchWriteCommandInput({
        tables: [usersTable([{ operation: 'DELETE', key: { userId: 'user-1', name: 'Ada' } }])],
      })
    ).toThrow('Delete key must contain exactly: userId.');
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['boolean', true],
    ['object', { id: 'user-1' }],
    ['array', ['user-1']],
    ['non-finite number', Number.POSITIVE_INFINITY],
  ])('rejects an invalid %s primary-key value', (_description, value) => {
    expect(() => buildValidatedBatchWriteCommandInput({ tables: [usersTable([deleteOperation(value)])] })).toThrow();
  });

  it('rejects identical partition-key and sort-key names', () => {
    expect(() =>
      customBatchWriteCmdInputSch.parse({
        tables: [
          {
            tableName: 'Users',
            keySchema: { partitionKey: 'id', sortKey: 'id' },
            operations: [{ operation: 'DELETE', key: { id: 'user-1' } }],
          },
        ],
      })
    ).toThrow('Partition key and sort key must be different.');
  });

  it('rejects unsupported values in a put item', () => {
    expect(() =>
      buildValidatedBatchWriteCommandInput({
        tables: [usersTable([{ operation: 'PUT', item: { userId: 'user-1', unsupported: undefined } }])],
      })
    ).toThrow('Unsupported DynamoDB value: undefined');
  });

  it.each([
    ['top-level', { tables: [usersTable([deleteOperation('user-1')])], unexpected: true }],
    ['table-level', { tables: [{ ...usersTable([deleteOperation('user-1')]), unexpected: true }] }],
    [
      'key-schema',
      {
        tables: [
          {
            ...usersTable([deleteOperation('user-1')]),
            keySchema: { partitionKey: 'userId', unexpected: true },
          },
        ],
      },
    ],
    [
      'operation-level',
      {
        tables: [usersTable([{ ...deleteOperation('user-1'), unexpected: true }])],
      },
    ],
  ])('rejects unknown %s properties because the schema is strict', (_description, input) => {
    expect(() => customBatchWriteCmdInputSch.parse(input)).toThrow();
  });

  it('rejects unsupported operation discriminators', () => {
    expect(() =>
      customBatchWriteCmdInputSch.parse({
        tables: [usersTable([{ operation: 'UPDATE', item: { userId: 'user-1' } }])],
      })
    ).toThrow();
  });
});
