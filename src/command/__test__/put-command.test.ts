import { describe, expect, it } from 'vitest';

import { CustomPutCmdInput } from '../../types/command-input.types';
import { buildValidatedPutCommand } from '../put-command';

function build(input: unknown) {
  return buildValidatedPutCommand(input as CustomPutCmdInput);
}

describe('buildValidatedPutCommand', () => {
  it('builds a minimal command with native item values and default response options', () => {
    expect(
      build({
        tableName: 'users',
        item: { id: 'user-001', name: 'Dash', active: true },
      })
    ).toEqual({
      TableName: 'users',
      Item: { id: 'user-001', name: 'Dash', active: true },
      ReturnValues: 'NONE',
      ReturnConsumedCapacity: 'NONE',
      ReturnItemCollectionMetrics: 'NONE',
    });
  });

  it('preserves supported put response options', () => {
    const command = build({
      tableName: 'users',
      item: { id: 'user-001' },
      returnValues: 'ALL_OLD',
      returnConsumedCapacity: 'TOTAL',
      returnItemCollectionMetrics: 'SIZE',
    });

    expect(command.ReturnValues).toBe('ALL_OLD');
    expect(command.ReturnConsumedCapacity).toBe('TOTAL');
    expect(command.ReturnItemCollectionMetrics).toBe('SIZE');
  });

  it('builds a condition with generated aliases and native expression values', () => {
    const values = {
      ':expectedStatus': 'DRAFT',
      ':expectedVersion': 2,
      ':enabled': true,
    };

    const command = build({
      tableName: 'users',
      item: { id: 'user-001' },
      conditionExpression: '#status = :expectedStatus AND #version = :expectedVersion AND enabled = :enabled',
      expressionAttributeValues: values,
    });

    expect(command.ConditionExpression).toBe(
      '#status = :expectedStatus AND #version = :expectedVersion AND enabled = :enabled'
    );
    expect(command.ExpressionAttributeNames).toEqual({ '#status': 'status', '#version': 'version' });
    expect(command.ExpressionAttributeValues).toEqual(values);
  });

  it('merges caller-provided attribute names with generated aliases', () => {
    const command = build({
      tableName: 'users',
      item: { id: 'user-001' },
      conditionExpression: '#status = :status',
      expressionAttributeNames: { '#tenant': 'tenantId' },
      expressionAttributeValues: { ':status': 'ACTIVE' },
    });

    expect(command.ExpressionAttributeNames).toEqual({ '#status': 'status', '#tenant': 'tenantId' });
  });

  it('allows a caller-provided alias that matches the generated mapping', () => {
    const command = build({
      tableName: 'users',
      item: { id: 'user-001' },
      conditionExpression: '#status = :status',
      expressionAttributeNames: { '#status': 'status' },
      expressionAttributeValues: { ':status': 'ACTIVE' },
    });

    expect(command.ExpressionAttributeNames).toEqual({ '#status': 'status' });
  });

  it('rejects a caller-provided alias that conflicts with the generated mapping', () => {
    expect(() =>
      build({
        tableName: 'users',
        item: { id: 'user-001' },
        conditionExpression: '#status = :status',
        expressionAttributeNames: { '#status': 'accountStatus' },
        expressionAttributeValues: { ':status': 'ACTIVE' },
      })
    ).toThrow(/conflicts with generated mapping/);
  });

  it('omits empty expression maps from the command input', () => {
    const command = build({
      tableName: 'users',
      item: { id: 'user-001' },
      conditionExpression: 'attribute_exists(id)',
      expressionAttributeNames: {},
      expressionAttributeValues: {},
    });

    expect(command).not.toHaveProperty('ExpressionAttributeNames');
    expect(command).not.toHaveProperty('ExpressionAttributeValues');
  });

  it.each([
    ['empty table name', { tableName: '   ', item: { id: 'user-001' } }],
    ['invalid item', { tableName: 'users', item: 'user-001' }],
    ['unsupported return values', { tableName: 'users', item: { id: 'user-001' }, returnValues: 'ALL_NEW' }],
    [
      'names without a condition',
      { tableName: 'users', item: { id: 'user-001' }, expressionAttributeNames: { '#status': 'status' } },
    ],
    [
      'values without a condition',
      { tableName: 'users', item: { id: 'user-001' }, expressionAttributeValues: { ':status': 'ACTIVE' } },
    ],
    ['unknown properties', { tableName: 'users', item: { id: 'user-001' }, unexpected: true }],
  ])('rejects %s', (_description, input) => {
    expect(() => build(input)).toThrow();
  });
});
