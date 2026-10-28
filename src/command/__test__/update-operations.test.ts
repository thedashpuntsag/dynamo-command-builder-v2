import { describe, expect, it } from 'vite-plus/test';
import { buildValidatedUpdateCommand } from '../update-command';
import { buildValidatedTransactWriteCommand } from '../transact-write-command';
import type { CustomUpdateCmdInput, CustomTransactWriteCmdInput, UpdateOperation } from '../../types';

const build = (fields: Record<string, unknown>) =>
  buildValidatedUpdateCommand({ tableName: 'Orders', key: { id: '1' }, ...fields } as CustomUpdateCmdInput);
const transact = (fields: Record<string, unknown>) =>
  buildValidatedTransactWriteCommand({
    transactItems: [{ operation: 'UPDATE', tableName: 'Orders', key: { id: '1' }, ...fields }],
  } as CustomTransactWriteCmdInput).TransactItems![0]!.Update!;

const allActions: readonly UpdateOperation[] = [
  { attr: 'status', set: 'CONFIRMED' },
  { attr: 'temporary', remove: true },
  { attr: 'attempts', add: 1 },
  { attr: 'tags', delete: new Set(['old']) },
];

describe.each([
  { name: 'Update', execute: build },
  { name: 'Transactional Update', execute: transact },
])('$name operations', ({ execute }) => {
  it('combines all four actions without raw expressions or placeholder maps', () => {
    const result = execute({ updates: allActions, condition: { attr: 'version', eq: 3 } });
    expect(result.UpdateExpression).toBe(
      'SET #updateName0 = :updateValue0 REMOVE #updateName1 ADD #updateName2 :updateValue1 DELETE #updateName3 :updateValue2'
    );
    expect(result.ConditionExpression).toBe('#conditionName0 = :conditionValue0');
    expect(result.ExpressionAttributeNames).toEqual({
      '#updateName0': 'status',
      '#updateName1': 'temporary',
      '#updateName2': 'attempts',
      '#updateName3': 'tags',
      '#conditionName0': 'version',
    });
    expect(result.ExpressionAttributeValues).toEqual({
      ':updateValue0': 'CONFIRMED',
      ':updateValue1': 1,
      ':updateValue2': new Set(['old']),
      ':conditionValue0': 3,
    });
  });

  it('aliases nested maps and canonical list indexes', () => {
    const result = execute({
      updates: [
        { attr: 'profile.addresses[00].city', set: 'Ulaanbaatar' },
        { attr: 'profile.addresses[1].city', remove: true },
      ],
    });
    expect(result.UpdateExpression).toBe(
      'SET #updateName0.#updateName1[0].#updateName2 = :updateValue0 REMOVE #updateName0.#updateName1[1].#updateName2'
    );
    expect(result.ExpressionAttributeNames).toEqual({
      '#updateName0': 'profile',
      '#updateName1': 'addresses',
      '#updateName2': 'city',
    });
  });

  it('generates each action clause once, preserving order within a clause', () => {
    const result = execute({
      updates: [
        { attr: 'first', remove: true },
        { attr: 'a', set: 1 },
        { attr: 'second', remove: true },
        { attr: 'b', set: 2 },
      ],
    });
    expect(result.UpdateExpression).toBe(
      'SET #updateName1 = :updateValue0, #updateName3 = :updateValue1 REMOVE #updateName0, #updateName2'
    );
  });

  it('omits value maps for REMOVE-only updates', () => {
    const result = execute({ updates: [{ attr: 'obsolete', remove: true }] });
    expect(result.UpdateExpression).toBe('REMOVE #updateName0');
    expect(result.ExpressionAttributeValues).toBeUndefined();
  });

  it('preserves native sets, binary, lists, maps, null, and false', () => {
    const values = [new Uint8Array([1]), new Set(['a']), { nested: [null, false] }, [], null, false, 0, 3n];
    for (const value of values)
      expect(execute({ updates: [{ attr: 'data', set: value }] }).ExpressionAttributeValues).toEqual({
        ':updateValue0': value,
      });
  });

  it('supports ADD with numeric and homogeneous set values', () => {
    for (const value of [-1, 2n, new Set(['a']), new Set([1, 2]), new Set([new Uint8Array([1])])]) {
      expect(execute({ updates: [{ attr: 'counter', add: value }] }).ExpressionAttributeValues).toEqual({
        ':updateValue0': value,
      });
    }
  });

  it('supports arithmetic, defaults, copying, and list operations', () => {
    const result = execute({
      updates: [
        { attr: 'count', increment: 2 },
        { attr: 'stock', decrement: 1 },
        { attr: 'createdAt', ifNotExists: 123 },
        { attr: 'backup', copyFrom: 'profile.name' },
        { attr: 'history', append: ['new'] },
        { attr: 'queue', prepend: ['first'] },
      ],
    });
    expect(result.UpdateExpression).toBe(
      'SET #updateName0 = #updateName0 + :updateValue0, #updateName1 = #updateName1 - :updateValue1, #updateName2 = if_not_exists(#updateName2, :updateValue2), #updateName3 = #updateName4.#updateName5, #updateName6 = list_append(#updateName6, :updateValue3), #updateName7 = list_append(:updateValue4, #updateName7)'
    );
    expect(result.ExpressionAttributeValues).toEqual({
      ':updateValue0': 2,
      ':updateValue1': 1,
      ':updateValue2': 123,
      ':updateValue3': ['new'],
      ':updateValue4': ['first'],
    });
  });

  it('reserves raw condition placeholders and suffixes', () => {
    const result = execute({
      updates: [{ attr: 'status', set: 'UPDATED' }],
      conditionExpression: '#updateName0 = :updateValue0 AND #updateName0_1 = :updateValue0_1',
      expressionAttributeNames: { '#updateName0': 'version', '#updateName0_1': 'owner' },
      expressionAttributeValues: { ':updateValue0': 3, ':updateValue0_1': 'user-1' },
    });
    expect(result.UpdateExpression).toBe('SET #updateName0_2 = :updateValue0_2');
    expect(result.ExpressionAttributeNames).toEqual({
      '#updateName0': 'version',
      '#updateName0_1': 'owner',
      '#updateName0_2': 'status',
    });
  });

  it('allows sibling paths and source/target references using pre-update values', () => {
    expect(() =>
      execute({
        updates: [
          { attr: 'a', copyFrom: 'b' },
          { attr: 'b', set: 2 },
          { attr: 'ab', remove: true },
        ],
      })
    ).not.toThrow();
  });

  it.each([
    {},
    { updates: [] },
    { updates: allActions, updateExpression: 'REMOVE old' },
    { updates: [{ attr: 'id', set: '2' }] },
    { updates: [{ attr: 'id.nested', remove: true }] },
    { updates: [{ attr: 'name', set: undefined }] },
    { updates: [{ attr: 'name', set: { nested: undefined } }] },
    { updates: [{ attr: 'name', set: NaN }] },
    { updates: [{ attr: 'name', set: Infinity }] },
    { updates: [{ attr: 'name', set: new Set() }] },
    { updates: [{ attr: 'count', add: 'one' }] },
    { updates: [{ attr: 'count', add: [] }] },
    { updates: [{ attr: 'count', increment: NaN }] },
    { updates: [{ attr: 'count', decrement: 'one' }] },
    { updates: [{ attr: 'tags', delete: ['old'] }] },
    { updates: [{ attr: 'tags', delete: new Set() }] },
    { updates: [{ attr: 'tags', add: new Set([1, 'a']) }] },
    { updates: [{ attr: 'nested.count', add: 1 }] },
    { updates: [{ attr: 'nested.tags', delete: new Set(['old']) }] },
    { updates: [{ attr: 'a', set: 1, remove: true }] },
    { updates: [{ attr: 'a' }] },
    { updates: [{ attr: 'a', remove: false }] },
    { updates: [{ attr: 'a', unknown: 1 }] },
    { updates: [{ attr: 'a', append: 'string' }] },
    { updates: [{ attr: 'a', prepend: [undefined] }] },
    { updates: [{ attr: 'a', copyFrom: 'bad[-1]' }] },
    { updates: [{ attr: 'a..b', set: 1 }] },
    { updates: [{ attr: 'a[-1]', set: 1 }] },
    { updates: [{ attr: 'a[1.5]', set: 1 }] },
    { updates: [{ attr: 'a[9007199254740992]', set: 1 }] },
    {
      updates: [
        { attr: 'a', set: 1 },
        { attr: 'a', remove: true },
      ],
    },
    {
      updates: [
        { attr: 'a.b', set: 1 },
        { attr: 'a', remove: true },
      ],
    },
    {
      updates: [
        { attr: 'a', set: {} },
        { attr: 'a.b', remove: true },
      ],
    },
    {
      updates: [
        { attr: 'a[00]', set: 1 },
        { attr: 'a[0]', remove: true },
      ],
    },
    {
      updates: [
        { attr: 'a[0]', set: {} },
        { attr: 'a[0].b', remove: true },
      ],
    },
    {
      updates: [
        { attr: 'a[0]', set: {} },
        { attr: 'a', remove: true },
      ],
    },
    { updates: [{ attr: 'a.'.repeat(33) + 'b', set: 1 }] },
  ])('rejects invalid updates: %j', (fields) => {
    expect(() => execute(fields)).toThrow();
  });

  it('rejects cyclic values', () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => execute({ updates: [{ attr: 'data', set: value }] })).toThrow(/acyclic/);
  });

  it('enforces the expression size limit', () => {
    expect(() =>
      execute({ updates: Array.from({ length: 150 }, (_, index) => ({ attr: `a${index}`, set: index })) })
    ).toThrow(/4 KB/);
  });

  it('enforces the operator/function budget', () => {
    expect(() =>
      execute({ updates: Array.from({ length: 151 }, (_, index) => ({ attr: `a${index}`, increment: 1 })) })
    ).toThrow(/300 operators/);
  });
});

it('keeps item patches and structured operations mutually exclusive', () => {
  expect(() => build({ item: { status: 'UPDATED' }, updates: allActions })).toThrow(/exactly one/);
});
