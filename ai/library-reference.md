# Dynamo Craft reference for AI agents

Use this reference when writing application code with the `dynamo-craft` npm package.

## What the library does

`dynamo-craft` validates developer-friendly inputs and builds command inputs for the AWS SDK v3 `DynamoDBDocumentClient`. It does not create a client, infer a table schema, or send requests.

Use native JavaScript values for keys, items, expression values, lists, maps, sets, binary data, and `null`. Do not manually marshal values into low-level `{ S: ... }`, `{ N: ... }`, or `{ M: ... }` objects.

## Installation

Install the library and its AWS SDK peer dependencies:

```bash
pnpm add dynamo-craft @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

Equivalent npm or Yarn commands are valid.

## Standard execution pattern

First build the SDK input, then pass it to the matching AWS command:

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { buildValidatedGetCommand } from 'dynamo-craft';

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));

const input = buildValidatedGetCommand({
  tableName: 'Users',
  key: { userId: 'user-1' },
  attributes: ['userId', 'profile.name', 'roles[0]'],
});

const result = await documentClient.send(new GetCommand(input));
```

Builder-to-command mapping:

| Dynamo Craft builder                   | AWS SDK command        |
| -------------------------------------- | ---------------------- |
| `buildValidatedGetCommand`             | `GetCommand`           |
| `buildValidatedPutCommand`             | `PutCommand`           |
| `buildValidatedUpdateCommand`          | `UpdateCommand`        |
| `buildValidatedDeleteCommandInput`     | `DeleteCommand`        |
| `buildValidatedQueryCommand`           | `QueryCommand`         |
| `buildValidatedScanCommand`            | `ScanCommand`          |
| `buildValidatedBatchGetCommand`        | `BatchGetCommand`      |
| `buildValidatedBatchWriteCommandInput` | `BatchWriteCommand`    |
| `buildValidatedTransactGetCommand`     | `TransactGetCommand`   |
| `buildValidatedTransactWriteCommand`   | `TransactWriteCommand` |

Builders throw when local validation fails. AWS can still reject validly shaped input because only AWS knows the real table schema, index schema, item types, permissions, and service limits.

## Get an item

```ts
const input = buildValidatedGetCommand({
  tableName: 'Users',
  key: { userId: 'user-1' },
  consistentRead: false,
  attributes: ['userId', 'email', 'profile.name'],
});
```

`attributes` creates a safe projection and supports nested paths and numeric list indexes. A key must match the table's actual primary key: one partition key, or a partition key plus sort key.

## Put an item

```ts
const input = buildValidatedPutCommand({
  tableName: 'Users',
  item: {
    userId: 'user-1',
    email: 'dash@example.com',
    status: 'ACTIVE',
  },
  condition: { attr: 'userId', notExists: true },
});
```

`Put` replaces the entire existing item. Include every attribute that must remain. The condition above implements create-only behavior.

## Update an item

Prefer structured `updates` over handwritten expressions:

```ts
const input = buildValidatedUpdateCommand({
  tableName: 'Orders',
  key: { orderId: 'order-1' },
  updates: [
    { attr: 'status', set: 'CONFIRMED' },
    { attr: 'temporaryNote', remove: true },
    { attr: 'attempts', add: 1 },
    { attr: 'stock', decrement: 2 },
    { attr: 'tags', add: new Set(['confirmed']) },
    { attr: 'history', append: ['confirmed'] },
    { attr: 'createdAt', ifNotExists: Date.now() },
  ],
  condition: { attr: 'version', eq: 3 },
  returnValues: 'ALL_NEW',
});
```

Each update entry must have `attr` and exactly one operation:

- `set`, `remove`, `add`, or `delete`;
- `increment` or `decrement`;
- `ifNotExists` or `copyFrom`;
- `append` or `prepend`.

Important semantics:

- `set` always writes a literal value, including maps and lists.
- `add` supports numbers and sets; `delete` removes members from a set.
- DynamoDB restricts `ADD` and `DELETE` to top-level attributes.
- Nested parent maps must already exist.
- Arithmetic requires an existing number; list operations require an existing list.
- Do not update a primary-key attribute.
- Update paths must not be duplicated or overlap as parent and child paths.
- Operations read the original item state, not results of earlier entries in the array.

Raw `updateExpression` remains available when structured updates cannot express a requirement. Do not mix `updates`, `item`, and `updateExpression`; they are alternative modes.

## Delete an item

```ts
const input = buildValidatedDeleteCommandInput({
  tableName: 'Orders',
  key: { orderId: 'order-1' },
  condition: { attr: 'status', eq: 'CANCELLED' },
  returnValues: 'ALL_OLD',
});
```

## Structured conditions and filters

A condition leaf has `attr` plus exactly one operator:

```ts
const condition = {
  and: [
    { attr: 'version', eq: 3 },
    { attr: 'total', gte: 100 },
    {
      or: [
        { attr: 'status', eq: 'READY' },
        { attr: 'status', beginsWith: 'APPROVED_' },
      ],
    },
    { attr: 'deletedAt', notExists: true },
    { not: { attr: 'tags', contains: 'blocked' } },
    { attr: 'items', size: { gt: 0 } },
  ],
};
```

Supported operators are `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `between`, `in`, `beginsWith`, `contains`, `notContains`, `exists`, `notExists`, `type`, and `size`. Combine conditions with `and`, `or`, and `not`.

Paths such as `profile.name` and `items[0].sku` refer to nested data. If an actual attribute name contains a dot or bracket, use a raw expression and explicit aliases instead.

For writes, choose one condition mode:

- `condition` for nested structured logic;
- `conditions` plus optional `conditionJoin` for record shorthand;
- `conditionExpression` plus expression mappings for raw DynamoDB syntax.

Do not mix these modes. Structured conditions generate aliases and values automatically.

## Query

```ts
const input = buildValidatedQueryCommand({
  tableName: 'Orders',
  indexName: 'status-createdAt-index',
  partitionKeys: { status: 'READY' },
  sortKeys: { createdAt: { between: [startTime, endTime] } },
  filter: { attr: 'total', gte: 100 },
  attributes: ['orderId', 'status', 'createdAt', 'total'],
  limit: 25,
  scanIndexForward: false,
  exclusiveStartKey: lastEvaluatedKey,
});

const page = await documentClient.send(new QueryCommand(input));
```

Query rules:

- `partitionKeys` is required and uses equality.
- `sortKeys` supports equality, `lt`, `lte`, `gt`, `gte`, `between`, and `beginsWith`.
- Key names and their object order must match the target table or index key definition, especially for multi-attribute keys.
- `filter`/`filters` is applied after DynamoDB reads matching key items and does not reduce consumed read capacity.
- `attributes` controls returned fields and also does not reduce consumed read capacity.
- A global secondary index does not support strongly consistent reads.
- Continue pagination by passing the response's `LastEvaluatedKey` as `exclusiveStartKey` until it is absent.

## Scan

```ts
const input = buildValidatedScanCommand({
  tableName: 'Orders',
  filter: {
    and: [
      { attr: 'status', eq: 'READY' },
      { attr: 'total', gte: 100 },
    ],
  },
  attributes: ['orderId', 'status', 'total'],
  limit: 25,
  exclusiveStartKey: lastEvaluatedKey,
});
```

Prefer `Query` when the access pattern has a known partition key. `Scan` examines table or index data before applying its filter and can be expensive. Paginate it like Query.

## Batch get

```ts
const input = buildValidatedBatchGetCommand({
  tables: [
    {
      tableName: 'Users',
      keys: [{ userId: 'user-1' }, { userId: 'user-2' }],
      attributes: ['userId', 'email'],
    },
    {
      tableName: 'Orders',
      keys: [{ accountId: 'account-1', orderId: 'order-1' }],
      consistentRead: true,
    },
  ],
});
```

A request supports at most 100 keys total. Process and retry `UnprocessedKeys`; a successful HTTP response does not guarantee that every key was processed. Result item order is not guaranteed.

## Batch write

```ts
const input = buildValidatedBatchWriteCommandInput({
  tables: [
    {
      tableName: 'Users',
      keySchema: { partitionKey: 'userId' },
      operations: [
        { operation: 'PUT', item: { userId: 'user-1', name: 'Dash' } },
        { operation: 'DELETE', key: { userId: 'user-2' } },
      ],
    },
  ],
});
```

Use `keySchema: { partitionKey, sortKey? }` to let the builder validate keys and put items. A request supports at most 25 operations total. Batch write supports only full puts and deletes, not updates or conditions. Retry `UnprocessedItems`, preferably with exponential backoff.

## Transactional get

```ts
const input = buildValidatedTransactGetCommand({
  transactItems: [
    { tableName: 'Users', key: { userId: 'user-1' }, attributes: ['email'] },
    { tableName: 'Orders', key: { orderId: 'order-1' } },
  ],
});
```

## Transactional write

```ts
const input = buildValidatedTransactWriteCommand({
  transactItems: [
    {
      operation: 'PUT',
      tableName: 'Orders',
      item: { orderId: 'order-1', status: 'PENDING' },
      condition: { attr: 'orderId', notExists: true },
    },
    {
      operation: 'UPDATE',
      tableName: 'Inventory',
      key: { sku: 'sku-1' },
      updates: [{ attr: 'stock', decrement: 1 }],
      condition: { attr: 'stock', gte: 1 },
    },
    {
      operation: 'CONDITION_CHECK',
      tableName: 'Accounts',
      key: { accountId: 'account-1' },
      condition: { attr: 'status', eq: 'ACTIVE' },
    },
  ],
});
```

Transactional writes support `PUT`, `UPDATE`, `DELETE`, and `CONDITION_CHECK`. Each operation has its own condition scope. Use a transaction only when the operations must succeed or fail atomically.

## Values and validation

Valid values include strings, finite numbers, `bigint`, booleans, `null`, `Uint8Array`, arrays, maps, and homogeneous nonempty `Set` instances. Do not pass `undefined`, functions, symbols, cyclic objects, nonfinite numbers, empty sets, or heterogeneous sets.

Examples:

```ts
const item = {
  id: 'item-1',
  count: 2,
  active: true,
  optionalValue: null,
  binary: new Uint8Array([1, 2, 3]),
  tags: new Set(['new', 'priority']),
  profile: { city: 'Ulaanbaatar' },
  history: [{ status: 'CREATED' }],
};
```

## Rules for AI-generated code

When generating code with this library:

1. Confirm the real table name, index name, partition key, and sort key. Never invent them silently.
2. Use the validated builder that matches the AWS SDK command.
3. Use native JavaScript values and `DynamoDBDocumentClient`.
4. Prefer `attributes`, structured conditions, structured filters, and structured updates over raw expressions.
5. Use raw expressions only for behavior the structured API cannot represent, such as attribute-to-attribute comparisons.
6. Preserve pagination and retry unprocessed batch work when the caller needs complete results.
7. Do not claim that a filter or projection reduces DynamoDB read capacity.
8. Handle conditional failures and AWS service errors at the application boundary.
9. Use the installed package's TypeScript declarations as the final authority if they differ from this document.
