import { describe, expect, it } from 'vitest';

import { buildValidatedDeleteCommandInput } from '../delete-command';

describe('buildValidatedDeleteCommandInput', () => {
  it('builds a command with a simple string partition key and default response options', () => {
    expect(buildValidatedDeleteCommandInput({ tableName: 'Users', key: { userId: 'user-1' } })).toEqual({
      TableName: 'Users',
      Key: { userId: { S: 'user-1' } },
      ReturnValues: 'NONE',
      ReturnValuesOnConditionCheckFailure: 'NONE',
      ReturnConsumedCapacity: 'NONE',
      ReturnItemCollectionMetrics: 'NONE',
    });
  });

  it('supports a composite partition key and numeric sort key', () => {
    expect(
      buildValidatedDeleteCommandInput({ tableName: 'Orders', key: { customerId: 'customer-1', orderNumber: 7 } }).Key
    ).toEqual({
      customerId: { S: 'customer-1' },
      orderNumber: { N: '7' },
    });
  });

  it('converts a numeric partition key to a DynamoDB attribute', () => {
    expect(buildValidatedDeleteCommandInput({ tableName: 'Orders', key: { orderId: -12 } }).Key).toEqual({
      orderId: { N: '-12' },
    });
  });

  it.each(['TOTAL', 'INDEXES'] as const)('preserves returnConsumedCapacity %s', (returnConsumedCapacity) => {
    expect(
      buildValidatedDeleteCommandInput({ tableName: 'Users', key: { id: 'user-1' }, returnConsumedCapacity })
        .ReturnConsumedCapacity
    ).toBe(returnConsumedCapacity);
  });

  it('preserves requested return values and item collection metrics', () => {
    const command = buildValidatedDeleteCommandInput({
      tableName: 'Users',
      key: { id: 'user-1' },
      returnValues: 'ALL_OLD',
      returnItemCollectionMetrics: 'SIZE',
    });

    expect(command.ReturnValues).toBe('ALL_OLD');
    expect(command.ReturnItemCollectionMetrics).toBe('SIZE');
  });

  it('builds a conditional delete with aliases, marshalled values, and failure return values', () => {
    const command = buildValidatedDeleteCommandInput({
      tableName: 'Users',
      key: { id: 'user-1' },
      conditionExpression: '  #status = :status AND #version = :version  ',
      expressionAttributeNames: { '#status': 'status', '#version': 'version' },
      expressionAttributeValues: { ':status': 'inactive', ':version': 2 },
      returnValuesOnConditionCheckFailure: 'ALL_OLD',
    });

    expect(command.ConditionExpression).toBe('#status = :status AND #version = :version');
    expect(command.ExpressionAttributeNames).toEqual({ '#status': 'status', '#version': 'version' });
    expect(command.ExpressionAttributeValues).toEqual({ ':status': { S: 'inactive' }, ':version': { N: '2' } });
    expect(command.ReturnValuesOnConditionCheckFailure).toBe('ALL_OLD');
  });

  it('supports a condition without expression placeholders', () => {
    const command = buildValidatedDeleteCommandInput({
      tableName: 'Users',
      key: { id: 'user-1' },
      conditionExpression: 'attribute_exists(id)',
    });

    expect(command.ConditionExpression).toBe('attribute_exists(id)');
    expect(command).not.toHaveProperty('ExpressionAttributeNames');
    expect(command).not.toHaveProperty('ExpressionAttributeValues');
  });

  it('marshalls scalar, list, and map condition values', () => {
    const command = buildValidatedDeleteCommandInput({
      tableName: 'Users',
      key: { id: 'user-1' },
      conditionExpression: 'active = :active AND deletedAt = :null AND tags = :tags AND profile = :profile',
      expressionAttributeValues: {
        ':active': false,
        ':null': null,
        ':tags': ['admin', 2],
        ':profile': { city: 'Ulaanbaatar' },
      },
    });

    expect(command.ExpressionAttributeValues).toEqual({
      ':active': { BOOL: false },
      ':null': { NULL: true },
      ':tags': { L: [{ S: 'admin' }, { N: '2' }] },
      ':profile': { M: { city: { S: 'Ulaanbaatar' } } },
    });
  });

  it.each([
    ['zero', {}],
    ['more than two', { tenant: 'acme', category: 'user', id: 'user-1' }],
  ])('rejects keys containing %s attributes', (_description, key) => {
    expect(() => buildValidatedDeleteCommandInput({ tableName: 'Users', key })).toThrow(
      'Key must contain a partition key and optional sort key.'
    );
  });

  it.each([
    ['empty string', ''],
    ['boolean', true],
    ['null', null],
    ['object', { id: 'user-1' }],
    ['array', ['user-1']],
    ['fractional number', 1.5],
    ['non-finite number', Infinity],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects an invalid %s key value', (_description, value) => {
    expect(() => buildValidatedDeleteCommandInput({ tableName: 'Users', key: { id: value } })).toThrow();
  });

  it.each([
    [
      'missing name',
      { conditionExpression: '#status = :status', expressionAttributeValues: { ':status': 'inactive' } },
      'Missing definition for expression name token "#status".',
    ],
    [
      'missing value',
      { conditionExpression: 'status = :status' },
      'Missing definition for expression value token ":status".',
    ],
    [
      'unused name',
      { conditionExpression: 'attribute_exists(id)', expressionAttributeNames: { '#status': 'status' } },
      'Unused expression name token "#status".',
    ],
    [
      'unused value',
      { conditionExpression: 'attribute_exists(id)', expressionAttributeValues: { ':status': 'inactive' } },
      'Unused expression value token ":status".',
    ],
    [
      'names without a condition',
      { expressionAttributeNames: { '#status': 'status' } },
      'ExpressionAttributeNames requires a conditionExpression.',
    ],
    [
      'values without a condition',
      { expressionAttributeValues: { ':status': 'inactive' } },
      'ExpressionAttributeValues requires a conditionExpression.',
    ],
    [
      'failure return values without a condition',
      { returnValuesOnConditionCheckFailure: 'ALL_OLD' },
      'ReturnValuesOnConditionCheckFailure requires a conditionExpression.',
    ],
  ])('rejects %s', (_description, options, message) => {
    expect(() => buildValidatedDeleteCommandInput({ tableName: 'Users', key: { id: 'user-1' }, ...options })).toThrow(
      expect.objectContaining({ issues: expect.arrayContaining([expect.objectContaining({ message })]) })
    );
  });

  it.each([
    ['missing table name', { key: { id: 'user-1' } }],
    ['missing key', { tableName: 'Users' }],
    ['empty key name', { tableName: 'Users', key: { '': 'user-1' } }],
    ['blank condition', { tableName: 'Users', key: { id: 'user-1' }, conditionExpression: '   ' }],
    ['unsupported return values', { tableName: 'Users', key: { id: 'user-1' }, returnValues: 'ALL_NEW' }],
    [
      'invalid failure return values',
      { tableName: 'Users', key: { id: 'user-1' }, returnValuesOnConditionCheckFailure: 'ALL_NEW' },
    ],
    ['invalid capacity option', { tableName: 'Users', key: { id: 'user-1' }, returnConsumedCapacity: 'INVALID' }],
    ['invalid metrics option', { tableName: 'Users', key: { id: 'user-1' }, returnItemCollectionMetrics: 'INVALID' }],
    ['unknown properties', { tableName: 'Users', key: { id: 'user-1' }, unexpected: true }],
  ])('rejects %s', (_description, input) => {
    expect(() => buildValidatedDeleteCommandInput(input)).toThrow();
  });

  it('rejects unsupported expression values during marshalling', () => {
    expect(() =>
      buildValidatedDeleteCommandInput({
        tableName: 'Users',
        key: { id: 'user-1' },
        conditionExpression: 'status = :status',
        expressionAttributeValues: { ':status': undefined },
      })
    ).toThrow('Unsupported DynamoDB value');
  });
});
