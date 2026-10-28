# Conditions across write commands

Put, Update, Delete, and transactional `PUT`, `UPDATE`, `DELETE`, and `CONDITION_CHECK` operations accept the same attribute-based condition syntax. Each leaf contains `attr` and exactly one operator. Use `and`, `or`, and `not` for nesting.

See [condition operators and validation](./put-command.md) for the full syntax.

## Update with optimistic locking

```typescript
import { buildValidatedUpdateCommand } from 'dynamo-craft';

const input = buildValidatedUpdateCommand({
  tableName: 'Orders',
  key: { id: 'order-1' },
  updates: [
    { attr: 'status', set: 'CONFIRMED' },
    { attr: 'version', set: 4 },
  ],
  condition: {
    and: [
      { attr: 'version', eq: 3 },
      { attr: 'status', beginsWith: 'PENDING' },
    ],
  },
  returnValues: 'ALL_NEW',
  returnValuesOnConditionCheckFailure: 'ALL_OLD',
});
```

The condition checks the existing item before the update. The update and its condition execute together in DynamoDB.

See [structured updates](./update-command.md) for SET, REMOVE, ADD, DELETE, arithmetic, lists, and defaults.

Existing explicit update expressions can also use structured conditions:

```typescript
import { buildValidatedUpdateCommand } from 'dynamo-craft';

buildValidatedUpdateCommand({
  tableName: 'Orders',
  key: { id: 'order-1' },
  updateExpression: 'SET #status = :next',
  expressionAttributeNames: { '#status': 'status' },
  expressionAttributeValues: { ':next': 'CONFIRMED' },
  condition: { attr: 'version', eq: 3 },
});
```

Update mappings belong to the update expression. Generated condition names and values reserve all supplied mappings and update-expression tokens, avoiding collisions even when the caller uses the compiler's placeholder names. Legacy `extraExpAttributeNames` and `extraExpAttributeValues` also participate in this scope for standalone Update.

## Conditional delete

```typescript
import { buildValidatedDeleteCommandInput } from 'dynamo-craft';

buildValidatedDeleteCommandInput({
  tableName: 'Orders',
  key: { id: 'order-1' },
  condition: {
    and: [
      { attr: 'status', eq: 'CANCELLED' },
      { attr: 'archivedAt', exists: true },
    ],
  },
  returnValues: 'ALL_OLD',
});
```

## Transactional writes and condition checks

Each transaction item has its own condition and placeholder scope:

```typescript
import { buildValidatedTransactWriteCommand } from 'dynamo-craft';

buildValidatedTransactWriteCommand({
  transactItems: [
    {
      operation: 'PUT',
      tableName: 'Orders',
      item: { id: 'order-new', status: 'PENDING' },
      condition: { attr: 'id', notExists: true },
    },
    {
      operation: 'UPDATE',
      tableName: 'Inventory',
      key: { id: 'sku-1' },
      updates: [{ attr: 'stock', decrement: 2 }],
      condition: { attr: 'stock', gte: 2 },
    },
    {
      operation: 'DELETE',
      tableName: 'Reservations',
      key: { id: 'reservation-1' },
      condition: { attr: 'status', eq: 'HELD' },
    },
    {
      operation: 'CONDITION_CHECK',
      tableName: 'Accounts',
      key: { id: 'account-1' },
      condition: { attr: 'status', eq: 'ACTIVE' },
    },
  ],
});
```

`CONDITION_CHECK` requires a condition. Other operations can be unconditional. Transactional Update accepts `updates` or raw `updateExpression`; standalone Update also supports item-based patches.

## Condition modes

All these operations accept either `condition`, record shorthand `conditions` with optional `conditionJoin`, or raw `conditionExpression`. The three condition modes are mutually exclusive. Raw expressions remain available for attribute-to-attribute comparisons and literal attribute names containing dots.

With structured conditions, Put, Delete, and ConditionCheck generate all mappings. Update allows caller mappings for its update expression. Query and Scan use `FilterExpression` and keep their existing filter APIs. Get and batch operations do not support condition expressions.
