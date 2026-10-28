import { describe, expect, it } from 'vite-plus/test';
import { buildValidatedPutCommand } from '../put-command';
import type { CustomPutCmdInput } from '../../types';

const build = (fields: Partial<CustomPutCmdInput>) =>
  buildValidatedPutCommand({ tableName: 'Orders', item: { id: '1' }, ...fields });
const invalid = (fields: unknown) => build(fields as Partial<CustomPutCmdInput>);

describe('Put structured conditions', () => {
  it('builds a create-only put without value placeholders', () => {
    expect(build({ conditions: { id: { notExists: true } } })).toMatchObject({
      ConditionExpression: 'attribute_not_exists(#conditionName0)',
      ExpressionAttributeNames: { '#conditionName0': 'id' },
    });
    expect(build({ conditions: { id: { notExists: true } } })).not.toHaveProperty('ExpressionAttributeValues');
  });

  it.each([
    ['eq', '='],
    ['ne', '<>'],
    ['lt', '<'],
    ['lte', '<='],
    ['gt', '>'],
    ['gte', '>='],
  ])('compiles %s', (operator, symbol) => {
    const result = invalid({ conditions: { version: { [operator]: 3 } } });
    expect(result.ConditionExpression).toBe(`#conditionName0 ${symbol} :conditionValue0`);
    expect(result.ExpressionAttributeValues).toEqual({ ':conditionValue0': 3 });
  });

  it('preserves native values including explicit map equality', () => {
    const values = [null, false, 1n, new Uint8Array([1]), ['a'], new Set(['a']), { nested: [1] }];
    for (const value of values) {
      expect(build({ conditions: { payload: { eq: value } } }).ExpressionAttributeValues).toEqual({
        ':conditionValue0': value,
      });
    }
  });

  it('aliases nested paths, list indexes, reserved words and repeated segments', () => {
    expect(build({ conditions: { 'items[0].size': 2, 'items[1].size': 3 } })).toMatchObject({
      ConditionExpression:
        '(#conditionName0[0].#conditionName1 = :conditionValue0) AND (#conditionName0[1].#conditionName1 = :conditionValue1)',
      ExpressionAttributeNames: { '#conditionName0': 'items', '#conditionName1': 'size' },
    });
  });

  it('supports shorthand functions, ranges, membership and OR', () => {
    const result = build({
      conditions: {
        version: { between: [1, 3] },
        status: { in: ['READY', 'PENDING'] },
        title: { beginsWith: 'Order' },
        tags: { notContains: 'blocked' },
        metadata: { type: 'M' },
        items: { size: { gt: 0 } },
        id: { exists: true },
      },
      conditionJoin: 'OR',
    });
    expect(result.ConditionExpression).toContain(' BETWEEN ');
    expect(result.ConditionExpression).toContain(' IN (');
    expect(result.ConditionExpression).toContain('begins_with(');
    expect(result.ConditionExpression).toContain('NOT (contains(');
    expect(result.ConditionExpression).toContain('attribute_type(');
    expect(result.ConditionExpression).toContain('size(');
    expect(result.ConditionExpression).toContain(' OR ');
  });

  it('preserves nested grouping with attribute-based leaves', () => {
    const result = build({
      condition: {
        and: [
          {
            or: [
              { attr: 'id', exists: true },
              { attr: 'deletedAt', notExists: true },
            ],
          },
          { not: { attr: 'owner', eq: 'blocked-owner' } },
          { attr: 'items', size: { gte: 2 } },
        ],
      },
    });
    expect(result.ConditionExpression).toBe(
      '((attribute_exists(#conditionName0)) OR (attribute_not_exists(#conditionName1))) AND (NOT (#conditionName2 = :conditionValue0)) AND (size(#conditionName3) >= :conditionValue1)'
    );
  });

  it('supports the proposed single-leaf syntax', () => {
    expect(build({ condition: { attr: 'status', beginsWith: 'PENDING' } })).toMatchObject({
      ConditionExpression: 'begins_with(#conditionName0, :conditionValue0)',
      ExpressionAttributeNames: { '#conditionName0': 'status' },
      ExpressionAttributeValues: { ':conditionValue0': 'PENDING' },
    });
    expect(build({ condition: { attr: 'status', eq: 'PENDING' } }).ConditionExpression).toBe(
      '#conditionName0 = :conditionValue0'
    );
  });

  it('supports multiple conditions on the same attribute', () => {
    expect(
      build({
        condition: {
          and: [
            { attr: 'version', gte: 3 },
            { attr: 'version', lt: 7 },
          ],
        },
      })
    ).toMatchObject({
      ConditionExpression: '(#conditionName0 >= :conditionValue0) AND (#conditionName0 < :conditionValue1)',
      ExpressionAttributeNames: { '#conditionName0': 'version' },
      ExpressionAttributeValues: { ':conditionValue0': 3, ':conditionValue1': 7 },
    });
  });

  it.each([
    { conditions: {} },
    { condition: { and: [{ attr: 'id', exists: true }] } },
    { conditions: { id: { eq: 1, ne: 2 } } },
    { conditions: { id: { in: [] } } },
    { conditions: { id: { in: Array.from({ length: 101 }, (_, i) => i) } } },
    { conditions: { 'items[-1]': 1 } },
    { conditions: { 'items[1.5]': 1 } },
    { conditions: { 'a..b': 1 } },
    { conditions: { ['a.'.repeat(33) + 'b']: 1 } },
    { conditions: { id: { eq: undefined } } },
    { conditions: { id: { eq: NaN } } },
    { conditions: { id: { eq: Infinity } } },
    { conditions: { id: { eq: { a: undefined } } } },
    { conditions: { id: new Set() } },
    { conditions: { id: { eq: new Set([1, 'a']) } } },
    { conditions: { metadata: { a: 1 } } },
    { conditions: { id: { exists: false } } },
    { condition: { attr: 'id', exists: true, notExists: true } },
    { condition: { attr: 'tags' } },
    { condition: { attr: 'id', beginsWith: 1 } },
    { conditions: { id: 1 }, conditionExpression: '#id = :id' },
    { conditions: { id: 1 }, condition: { attr: 'id', exists: true } },
    { conditions: { id: 1 }, expressionAttributeNames: { '#id': 'id' } },
    { condition: { eq: 'PENDING' } },
    { condition: { attr: '', eq: 'PENDING' } },
    { condition: { attr: 'status', eq: 'PENDING', gte: '' } },
    { condition: { attr: 'status', eq: undefined } },
    {
      condition: {
        attr: 'status',
        and: [
          { attr: 'id', exists: true },
          { attr: 'version', gte: 1 },
        ],
      },
    },
    { conditionJoin: 'OR' },
  ])('rejects invalid conditions: %j', (fields) => {
    expect(() => invalid(fields)).toThrow();
  });

  it('rejects cyclic values clearly', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => build({ conditions: { data: { eq: value } } })).toThrow(/acyclic/);
  });

  it('accepts 100 IN values and a 32-dereference path', () => {
    expect(() =>
      build({ conditions: { ['a.'.repeat(32) + 'b']: { in: Array.from({ length: 100 }, (_, i) => i) } } })
    ).not.toThrow();
  });

  it('rejects expressions larger than 4 KB', () => {
    expect(() =>
      build({
        condition: {
          or: Array.from({ length: 100 }, (_, i) => ({
            attr: `field${i}`,
            eq: i,
          })),
        },
      })
    ).toThrow(/4 KB/);
  });
  it('rejects cyclic logical nodes before recursive parsing', () => {
    const node: Record<string, unknown> = {};
    node.not = node;
    expect(() => invalid({ condition: node })).toThrow(/acyclic/);
  });

  it('compiles ranges, membership, and types deterministically', () => {
    const input = {
      condition: {
        and: [
          { attr: 'version', between: [1, 7] },
          { attr: 'tags', size: { in: [1, 2] } },
          { attr: 'payload', type: 'BS' },
        ],
      },
    } as const;
    const result = build(input);
    expect(build(input)).toEqual(result);
    expect(result.ConditionExpression).toContain('#conditionName0 BETWEEN :conditionValue0 AND :conditionValue1');
    expect(result.ConditionExpression).toContain('size(#conditionName1) IN (:conditionValue2, :conditionValue3)');
    expect(result.ExpressionAttributeValues).toEqual({
      ':conditionValue0': 1,
      ':conditionValue1': 7,
      ':conditionValue2': 1,
      ':conditionValue3': 2,
      ':conditionValue4': 'BS',
    });
  });

  it('rejects excessive operator counts', () => {
    expect(() =>
      build({ condition: { and: Array.from({ length: 151 }, () => ({ attr: 'id', exists: true as const })) } })
    ).toThrow(/300 operators/);
  });
});
