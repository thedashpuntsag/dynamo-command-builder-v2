import { describe, expect, it } from 'vite-plus/test';
import { buildValidatedUpdateCommand } from '../update-command';
import { buildValidatedDeleteCommandInput } from '../delete-command';
import { buildValidatedTransactWriteCommand } from '../transact-write-command';
import type { CustomUpdateCmdInput, CustomTransactWriteCmdInput } from '../../types';

const update = (fields: Record<string, unknown>) =>
  buildValidatedUpdateCommand({
    tableName: 'Orders',
    key: { id: '1' },
    item: { status: 'CONFIRMED' },
    ...fields,
  } as CustomUpdateCmdInput);
const transaction = (operation: string, fields: Record<string, unknown>) => {
  const item = {
    operation,
    tableName: 'Orders',
    ...(operation === 'PUT' ? { item: { id: '1' } } : { key: { id: '1' } }),
    ...(operation === 'UPDATE'
      ? { updateExpression: 'SET #status = :status', expressionAttributeValues: { ':status': 'UPDATED' } }
      : {}),
    ...fields,
  };
  const output = buildValidatedTransactWriteCommand({ transactItems: [item] } as CustomTransactWriteCmdInput);
  const result = output.TransactItems![0]!;
  return result.Put ?? result.Update ?? result.Delete ?? result.ConditionCheck!;
};
const builders = [
  { name: 'Update', build: update },
  {
    name: 'Delete',
    build: (fields: Record<string, unknown>) =>
      buildValidatedDeleteCommandInput({ tableName: 'Orders', key: { id: '1' }, ...fields }),
  },
  ...['PUT', 'UPDATE', 'DELETE', 'CONDITION_CHECK'].map((operation) => ({
    name: `Transaction ${operation}`,
    build: (fields: Record<string, unknown>) => transaction(operation, fields),
  })),
];

describe.each(builders)('$name structured conditions', ({ build }) => {
  it('compiles nested attribute conditions', () => {
    const output = build({
      condition: {
        and: [
          { attr: 'status', beginsWith: 'PENDING' },
          {
            or: [
              { attr: 'version', gte: 3 },
              { attr: 'deletedAt', notExists: true },
            ],
          },
        ],
      },
      returnValuesOnConditionCheckFailure: 'ALL_OLD',
    });
    expect(output.ConditionExpression).toBe(
      '(begins_with(#conditionName0, :conditionValue0)) AND ((#conditionName1 >= :conditionValue1) OR (attribute_not_exists(#conditionName2)))'
    );
    expect(output.ExpressionAttributeNames).toMatchObject({
      '#conditionName0': 'status',
      '#conditionName1': 'version',
      '#conditionName2': 'deletedAt',
    });
    expect(output.ExpressionAttributeValues).toMatchObject({ ':conditionValue0': 'PENDING', ':conditionValue1': 3 });
    expect(output.ReturnValuesOnConditionCheckFailure).toBe('ALL_OLD');
  });

  it('supports record shorthand and OR', () => {
    const output = build({ conditions: { version: 3, deletedAt: { notExists: true } }, conditionJoin: 'OR' });
    expect(output.ConditionExpression).toBe(
      '(#conditionName0 = :conditionValue0) OR (attribute_not_exists(#conditionName1))'
    );
  });

  it('handles existence-only conditions without empty value maps', () => {
    const output = build({ condition: { attr: 'id', exists: true } });
    expect(output.ConditionExpression).toBe('attribute_exists(#conditionName0)');
    if (output.ExpressionAttributeValues)
      expect(Object.keys(output.ExpressionAttributeValues).length).toBeGreaterThan(0);
  });

  it.each([
    { condition: { attr: 'id', exists: true }, conditionExpression: 'attribute_exists(id)' },
    { condition: { attr: 'id', exists: true }, conditions: { id: '1' } },
    { conditionJoin: 'OR' },
    { condition: { attr: 'id', eq: 1, gte: 1 } },
  ])('rejects conflicting or malformed condition modes: %j', (fields) => {
    expect(() => build(fields)).toThrow();
  });
});

describe('Update expression token scopes', () => {
  it('merges conditions with generated item updates', () => {
    const output = update({ item: { version: 4 }, condition: { attr: 'version', eq: 3 } });
    expect(output.UpdateExpression).toBe('SET #updateAttr0 = :updateVal0');
    expect(output.ExpressionAttributeNames).toEqual({ '#updateAttr0': 'version', '#conditionName0': 'version' });
    expect(output.ExpressionAttributeValues).toEqual({ ':updateVal0': 4, ':conditionValue0': 3 });
  });

  it('reserves caller tokens, generated suffixes and legacy mappings', () => {
    const output = update({
      item: undefined,
      updateExpression: 'SET #conditionName0 = :conditionValue0, #conditionName0_1 = :conditionValue0_1',
      expressionAttributeNames: { '#conditionName0': 'status' },
      expressionAttributeValues: { ':conditionValue0': 'UPDATED' },
      extraExpAttributeNames: { '#conditionName0_1': 'message' },
      extraExpAttributeValues: { ':conditionValue0_1': 'hello' },
      condition: { attr: 'version', eq: 3 },
    });
    expect(output.ConditionExpression).toBe('#conditionName0_2 = :conditionValue0_2');
    expect(output.ExpressionAttributeNames).toEqual({
      '#conditionName0': 'status',
      '#conditionName0_1': 'message',
      '#conditionName0_2': 'version',
    });
    expect(output.ExpressionAttributeValues).toEqual({
      ':conditionValue0': 'UPDATED',
      ':conditionValue0_1': 'hello',
      ':conditionValue0_2': 3,
    });
  });

  it('does not let generated conditions satisfy missing update values', () => {
    expect(() =>
      update({
        item: undefined,
        updateExpression: 'SET #status = :conditionValue0',
        condition: { attr: 'version', eq: 3 },
      })
    ).toThrow('Missing expression attribute value: ":conditionValue0"');
  });

  it('does not let generated conditions override inferred update aliases', () => {
    const output = update({
      item: undefined,
      updateExpression: 'SET #conditionName0 = :next',
      expressionAttributeValues: { ':next': 4 },
      condition: { attr: 'version', eq: 3 },
    });
    expect(output.ExpressionAttributeNames).toEqual({
      '#conditionName0': 'conditionName0',
      '#conditionName0_1': 'version',
    });
  });

  it('retains raw condition support', () => {
    const output = update({
      conditionExpression: '#version = :expected',
      expressionAttributeValues: { ':expected': 3 },
    });
    expect(output.ConditionExpression).toBe('#version = :expected');
    expect(output.ExpressionAttributeNames).toMatchObject({ '#version': 'version' });
  });
});

describe('Transaction conditions', () => {
  it('reserves update tokens without overwriting values or aliases', () => {
    const output = transaction('UPDATE', {
      updateExpression: 'SET #conditionName0 = :conditionValue0',
      expressionAttributeNames: { '#conditionName0': 'status' },
      expressionAttributeValues: { ':conditionValue0': 'UPDATED' },
      condition: { attr: 'version', eq: 3 },
    });
    expect(output.ConditionExpression).toBe('#conditionName0_1 = :conditionValue0_1');
    expect(output.ExpressionAttributeNames).toEqual({ '#conditionName0': 'status', '#conditionName0_1': 'version' });
    expect(output.ExpressionAttributeValues).toEqual({ ':conditionValue0': 'UPDATED', ':conditionValue0_1': 3 });
  });

  it('requires a condition for ConditionCheck', () => {
    expect(() => transaction('CONDITION_CHECK', {})).toThrow(/requires a condition/);
  });

  it('keeps placeholder scopes independent across operations', () => {
    const output = buildValidatedTransactWriteCommand({
      transactItems: [
        { operation: 'PUT', tableName: 'Orders', item: { id: '1' }, condition: { attr: 'id', notExists: true } },
        { operation: 'DELETE', tableName: 'Orders', key: { id: '2' }, condition: { attr: 'version', eq: 3 } },
      ],
    });
    expect(output.TransactItems![0]!.Put!.ExpressionAttributeNames).toEqual({ '#conditionName0': 'id' });
    expect(output.TransactItems![1]!.Delete!.ExpressionAttributeNames).toEqual({ '#conditionName0': 'version' });
  });

  it.each(['PUT', 'DELETE', 'CONDITION_CHECK'])(
    'rejects caller expression maps with structured %s conditions',
    (operation) => {
      expect(() =>
        transaction(operation, { condition: { attr: 'id', exists: true }, expressionAttributeNames: { '#id': 'id' } })
      ).toThrow(/requires conditionExpression/);
    }
  );
});
