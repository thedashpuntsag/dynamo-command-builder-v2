import { describe, expect, it } from 'vite-plus/test';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  customGetCmdInputSch,
  customDeleteCmdInputSch,
  customUpdateCmdInputSch,
  customBatchGetCmdInputSch,
  customBatchWriteCmdInputSch,
  customPutCmdInputSch,
  customTransactGetCmdInputSch,
  customTransactWriteCmdInputSch,
  customQueryCmdInputSch,
} from '../command-input.types';
import {
  dynamoGetRequestSch,
  dynamoBatchGetRequestSch,
  dynamoTransactGetRequestSch,
  decodeDynamoValue,
  parseTypedJson,
} from '../read-command.types';
import { dynamoReadQueryRequestSch } from '../query-request.types';

import { parseDynamoNumber } from '../../utils/dynamo-number';
import { convertDynamoReadQueryRequest } from '../../utils/query-request';
import { buildValidatedQueryCommand } from '../../command/query-command';
import { buildValidatedBatchGetCommand } from '../../command/batch-get-command';
import { buildValidatedBatchWriteCommandInput } from '../../command/batch-write-command';

const keySchemas = [
  { name: 'Get', parse: (key: unknown) => customGetCmdInputSch.safeParse({ tableName: 'Orders', key }) },
  { name: 'Delete', parse: (key: unknown) => customDeleteCmdInputSch.safeParse({ tableName: 'Orders', key }) },
  {
    name: 'Update',
    parse: (key: unknown) => customUpdateCmdInputSch.safeParse({ tableName: 'Orders', key, item: { value: 1 } }),
  },
  {
    name: 'BatchGet',
    parse: (key: unknown) => customBatchGetCmdInputSch.safeParse({ tables: [{ tableName: 'Orders', keys: [key] }] }),
  },
  {
    name: 'BatchDelete',
    parse: (key: unknown) =>
      customBatchWriteCmdInputSch.safeParse({
        tables: [
          { tableName: 'Orders', keySchema: { partitionKey: 'id' }, operations: [{ operation: 'DELETE', key }] },
        ],
      }),
  },
  {
    name: 'TransactGet',
    parse: (key: unknown) => customTransactGetCmdInputSch.safeParse({ transactItems: [{ tableName: 'Orders', key }] }),
  },
  {
    name: 'TransactUpdate',
    parse: (key: unknown) =>
      customTransactWriteCmdInputSch.safeParse({
        transactItems: [{ operation: 'UPDATE', tableName: 'Orders', key, updates: [{ attr: 'value', set: 1 }] }],
      }),
  },
  {
    name: 'Alternate Get',
    parse: (key: unknown) => dynamoGetRequestSch.safeParse({ operation: 'GET', table: 'Orders', key }),
  },
  {
    name: 'Alternate BatchGet',
    parse: (key: unknown) =>
      dynamoBatchGetRequestSch.safeParse({ operation: 'BATCH_GET', requestItems: { Orders: { keys: [key] } } }),
  },
  {
    name: 'Alternate TransactGet',
    parse: (key: unknown) =>
      dynamoTransactGetRequestSch.safeParse({ operation: 'TRANSACT_GET', transactItems: [{ table: 'Orders', key }] }),
  },
];

describe.each(keySchemas)('$name key validation', ({ parse }) => {
  it('accepts all native scalar key categories consistently', () => {
    for (const value of ['id', 1.5, -1, 9007199254740993n, new Uint8Array([1])])
      expect(parse({ id: value }).success).toBe(true);
  });
  it('rejects invalid scalars and key shapes without throwing', () => {
    for (const value of [
      '',
      null,
      undefined,
      false,
      {},
      [],
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      new Uint8Array(),
    ])
      expect(parse({ id: value }).success).toBe(false);
    for (const key of [{}, { a: 1, b: 2, c: 3 }]) expect(parse(key).success).toBe(false);
  });
});

describe('key identity and pagination', () => {
  it('detects duplicates across bigint/number and binary representations', () => {
    for (const keys of [
      [{ id: 1 }, { id: 1n }],
      [{ id: new Uint8Array([1]) }, { id: new Uint8Array([1]) }],
    ]) {
      expect(
        dynamoBatchGetRequestSch.safeParse({ operation: 'BATCH_GET', requestItems: { Orders: { keys } } }).success
      ).toBe(false);
      expect(() => buildValidatedBatchGetCommand({ tables: [{ tableName: 'Orders', keys }] })).toThrow(/Duplicate/);
    }
  });
  it('builds batches containing bigint, fractional, and binary keys', () => {
    for (const id of [9007199254740993n, 1.5, new Uint8Array([1])]) {
      expect(
        buildValidatedBatchGetCommand({ tables: [{ tableName: 'Orders', keys: [{ id }] }] }).RequestItems?.Orders?.Keys
      ).toEqual([{ id }]);
      expect(
        buildValidatedBatchWriteCommandInput({
          tables: [
            {
              tableName: 'Orders',
              keySchema: { partitionKey: 'id' },
              operations: [{ operation: 'DELETE', key: { id } }],
            },
          ],
        }).RequestItems?.Orders
      ).toEqual([{ DeleteRequest: { Key: { id } } }]);
    }
  });
  it('detects duplicate binary and numeric batch-write targets', () => {
    for (const [left, right] of [
      [1, 1n],
      [new Uint8Array([1]), new Uint8Array([1])],
    ]) {
      expect(() =>
        buildValidatedBatchWriteCommandInput({
          tables: [
            {
              tableName: 'Orders',
              keySchema: { partitionKey: 'id' },
              operations: [
                { operation: 'PUT', item: { id: left } },
                { operation: 'DELETE', key: { id: right } },
              ],
            },
          ],
        })
      ).toThrow(/same item/);
    }
  });
  it('rejects invalid pagination scalars and unsafe numeric JSON', () => {
    const base = { table: 'Orders', pkAttr1Name: 'id', pkAttr1Value: '1' };
    for (const lastEvaluatedKey of [{ id: undefined }, { id: false }, { id: '' }, '{"id":9007199254740993}'])
      expect(dynamoReadQueryRequestSch.safeParse({ ...base, lastEvaluatedKey }).success).toBe(false);
    expect(dynamoReadQueryRequestSch.safeParse({ ...base, lastEvaluatedKey: { id: 9007199254740993n } }).success).toBe(
      true
    );
  });
});

const payloadSchemas = [
  {
    name: 'Put',
    parse: (value: unknown) => customPutCmdInputSch.safeParse({ tableName: 'Orders', item: { id: '1', data: value } }),
  },
  {
    name: 'BatchPut',
    parse: (value: unknown) =>
      customBatchWriteCmdInputSch.safeParse({
        tables: [
          {
            tableName: 'Orders',
            keySchema: { partitionKey: 'id' },
            operations: [{ operation: 'PUT', item: { id: '1', data: value } }],
          },
        ],
      }),
  },
  {
    name: 'TransactPut',
    parse: (value: unknown) =>
      customTransactWriteCmdInputSch.safeParse({
        transactItems: [{ operation: 'PUT', tableName: 'Orders', item: { id: '1', data: value } }],
      }),
  },
  {
    name: 'Update item',
    parse: (value: unknown) =>
      customUpdateCmdInputSch.safeParse({ tableName: 'Orders', key: { id: '1' }, item: { data: value } }),
  },
  {
    name: 'Update operation',
    parse: (value: unknown) =>
      customUpdateCmdInputSch.safeParse({
        tableName: 'Orders',
        key: { id: '1' },
        updates: [{ attr: 'data', set: value }],
      }),
  },
  {
    name: 'Query filter',
    parse: (value: unknown) =>
      customQueryCmdInputSch.safeParse({
        tableName: 'Orders',
        partitionKeys: { id: '1' },
        filters: { data: { eq: value } },
      }),
  },
];

describe.each(payloadSchemas)('$name native values', ({ parse }) => {
  it('rejects invalid nested values consistently', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse: unknown[] = [];
    sparse.length = 1;
    for (const value of [
      NaN,
      Number.MAX_SAFE_INTEGER + 1,
      Infinity,
      undefined,
      new Set(),
      new Set([1, 'a']),
      new Set([1, 9007199254740993n]),
      { nested: undefined },
      [undefined],
      sparse,
      new Date(),
      cycle,
    ])
      expect(parse(value).success).toBe(false);
  });
  it('accepts native documents, preserving valid empty map/list values', () => {
    for (const value of [null, false, 1n, {}, [], { nested: [1, null] }, new Set(['a']), new Uint8Array([1])])
      expect(parse(value).success).toBe(true);
  });
});

describe('exact number and collection decoding', () => {
  it.each([
    ['1e3', 1000],
    ['-1.5e-2', -0.015],
    ['9007199254740993', 9007199254740993n],
    ['-9007199254740993', -9007199254740993n],
    ['9007199254740993.0', 9007199254740993n],
    ['1.000', 1],
    ['-0', 0],
    ['0.1', 0.1],
    ['1e-130', 1e-130],
  ] as const)('decodes %s exactly', (input, expected) => {
    expect(decodeDynamoValue(input, 'N')).toBe(expected);
  });
  it.each([
    '0.10000000000000001',
    '1e126',
    '1e-131',
    '123456789012345678901234567890123456789',
    'NaN',
    'Infinity',
    '0x10',
  ])('rejects unsupported numeric text %s', (value) => {
    expect(() => parseDynamoNumber(value)).toThrow();
  });
  it('validates and decodes native set types', () => {
    expect(decodeDynamoValue('["a","b"]', 'SS')).toEqual(new Set(['a', 'b']));
    expect([...(decodeDynamoValue('[1, "9007199254740993", "1.5e2"]', 'NS') as Set<unknown>)].map(String)).toEqual([
      '1',
      '9007199254740993',
      '150',
    ]);
    expect(decodeDynamoValue('["AQI=", "AwQ="]', 'BS')).toEqual(
      new Set([new Uint8Array([1, 2]), new Uint8Array([3, 4])])
    );
  });
  it.each([
    ['SS', '[]'],
    ['SS', '[1]'],
    ['NS', '["not-a-number"]'],
    ['NS', '[true]'],
    ['NS', '[9007199254740993]'],
    ['BS', '"AQI="'],
    ['BS', '["bad!"]'],
    ['M', '[]'],
    ['M', 'null'],
    ['L', '{}'],
  ] as const)('rejects wrong %s shape %s', (type, value) => {
    expect(() => decodeDynamoValue(value, type)).toThrow();
  });
  it('preserves strings that contain numeric text, quotes, and escapes', () => {
    const input = { text: '9007199254740993 "quoted" \\ escaped', nested: [0.1, '1e999'] };
    expect(parseTypedJson(JSON.stringify(input))).toEqual(input);
    expect(decodeDynamoValue(JSON.stringify(input), 'M')).toEqual(input);
  });
  it('rejects nested lossy JSON number literals', () => {
    for (const text of ['{"n":9007199254740993}', '[0.10000000000000001]'])
      expect(() => parseTypedJson(text)).toThrow();
  });
  it('preserves literal key and filter names that differ only by whitespace', () => {
    const result = customQueryCmdInputSch.parse({
      tableName: 'Orders',
      partitionKeys: { 'tenant ': 'a', tenant: 'b' },
      sortKeys: { 'year ': 1, year: 2 },
      filters: { 'status ': 'A', status: 'B' },
    });
    expect(result.partitionKeys).toEqual({ 'tenant ': 'a', tenant: 'b' });
    expect(result.sortKeys).toEqual({ 'year ': 1, year: 2 });
    expect(result.filters).toEqual({ 'status ': 'A', status: 'B' });
  });
  it('serializes the HTTP adapter output with exact key and set types through the SDK', async () => {
    let body: Record<string, unknown> = {};
    const client = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: 'us-east-1',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        requestHandler: {
          handle: async (request: { body?: unknown }) => {
            body = JSON.parse(String(request.body));
            return { response: { statusCode: 200, headers: {}, body: new TextEncoder().encode('{}') } };
          },
        },
      })
    );
    const input = convertDynamoReadQueryRequest({
      table: 'Orders',
      pkAttr1Name: 'id',
      pkAttr1Value: '9007199254740993',
      pkAttr1ValueType: 'N',
      filterAttr1Name: 'tags',
      filterAttr1Condition: 'EQUAL_TO',
      filterAttr1ValueType: 'SS',
      filterAttr1Value: '["a","b"]',
      filterAttr2Name: 'numbers',
      filterAttr2Condition: 'EQUAL_TO',
      filterAttr2ValueType: 'NS',
      filterAttr2Value: '[1,"9007199254740993"]',
      filterAttr3Name: 'binary',
      filterAttr3Condition: 'EQUAL_TO',
      filterAttr3ValueType: 'BS',
      filterAttr3Value: '["AQI="]',
    });
    await client.send(new QueryCommand(buildValidatedQueryCommand(input)));
    expect(body.ExpressionAttributeValues).toEqual({
      ':pk0': { N: '9007199254740993' },
      ':filter0': { SS: ['a', 'b'] },
      ':filter1': { NS: ['1', '9007199254740993'] },
      ':filter2': { BS: ['AQI='] },
    });
    client.destroy();
  });
});

it('keeps nested validation issue paths when document validators are shared', () => {
  const result = customPutCmdInputSch.safeParse({
    tableName: 'Orders',
    item: { id: '1', data: { list: [undefined] } },
  });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues[0]?.path).toEqual(['item', 'data', 'list', 0]);
});
