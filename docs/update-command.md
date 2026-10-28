# Structured updates

Use `updates` to build Update and transactional Update requests without writing DynamoDB expressions or placeholder maps. Each entry names an `attr` and exactly one operation:

```typescript
import { buildValidatedUpdateCommand } from 'dynamo-craft';

const input = buildValidatedUpdateCommand({
  tableName: 'Orders',
  key: { id: 'order-1' },
  updates: [
    { attr: 'status', set: 'CONFIRMED' },
    { attr: 'temporary', remove: true },
    { attr: 'attempts', add: 1 },
    { attr: 'tags', delete: new Set(['old']) },
  ],
  condition: {
    and: [
      { attr: 'status', eq: 'PENDING' },
      { attr: 'version', eq: 3 },
    ],
  },
  returnValues: 'ALL_NEW',
});
```

Pass the returned input to `new UpdateCommand(input)` and send it with a configured `DynamoDBDocumentClient`. The builder constructs and validates inputs; DynamoDB executes the update.

## Operations

| Operation     | Example                                        | Behavior                                                             |
| ------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `set`         | `{ attr: 'profile.name', set: 'Dash' }`        | Assign a literal value, including maps, lists, sets, binary, or null |
| `remove`      | `{ attr: 'items[0]', remove: true }`           | Remove an attribute or list element                                  |
| `add`         | `{ attr: 'attempts', add: 1 }`                 | Add to a number; a missing number starts from zero                   |
| `add`         | `{ attr: 'tags', add: new Set(['new']) }`      | Union set elements                                                   |
| `delete`      | `{ attr: 'tags', delete: new Set(['old']) }`   | Remove elements from a set                                           |
| `increment`   | `{ attr: 'stock', increment: 2 }`              | SET arithmetic against an existing number                            |
| `decrement`   | `{ attr: 'stock', decrement: 2 }`              | SET subtraction against an existing number                           |
| `ifNotExists` | `{ attr: 'createdAt', ifNotExists: 123 }`      | Assign a default only if the attribute is missing                    |
| `copyFrom`    | `{ attr: 'backup', copyFrom: 'profile.name' }` | Copy the existing value at another path                              |
| `append`      | `{ attr: 'history', append: ['new'] }`         | Append elements to an existing list                                  |
| `prepend`     | `{ attr: 'queue', prepend: ['first'] }`        | Prepend elements to an existing list                                 |

`set` values are always literal data; `{ attr: 'metadata', set: { increment: 1 } }` writes a map. Functions and references use their own operations, avoiding ambiguity with map values.

`ADD` and `DELETE` support top-level attributes only. `add` takes a finite number, bigint, or nonempty homogeneous set; `delete` takes a nonempty homogeneous set. Use `remove` to remove an entire attribute. Number and binary sets use native `Set` instances.

Nested paths use dots and nonnegative list indexes. Parent maps must already exist. Arithmetic requires an existing numeric value; `append` and `prepend` require an existing list. The library does not initialize parent maps or guess item types.

All right-hand references read the original item state. Array order does not make one operation's result available to a later operation. Each action clause is emitted once, in `SET`, `REMOVE`, `ADD`, `DELETE` order, retaining input order within each clause.

## Transactions

Transactional Update accepts the same `updates` array and condition syntax:

```typescript
import { buildValidatedTransactWriteCommand } from 'dynamo-craft';

buildValidatedTransactWriteCommand({
  transactItems: [
    {
      operation: 'UPDATE',
      tableName: 'Inventory',
      key: { id: 'sku-1' },
      updates: [
        { attr: 'stock', decrement: 2 },
        { attr: 'reservationCount', add: 1 },
      ],
      condition: { attr: 'stock', gte: 2 },
    },
  ],
});
```

## Validation and compatibility

- Standalone Update accepts exactly one of `updates`, `item`, or raw `updateExpression`. Transactional Update accepts exactly one of `updates` or raw `updateExpression`.
- `item` remains a simple SET patch whose property names are literal attributes; `updates[].attr` describes a document path.
- Update targets cannot be primary-key attributes, duplicated paths, or overlapping parent/child paths. Siblings such as `profile.name` and `profile.age` are allowed.
- Invalid paths, undefined or cyclic values, nonfinite numbers, and empty or heterogeneous sets are rejected. The structured API caps actions at 300 and enforces a 4 KB expression size and a 300-operator/function budget.
- Names and values are generated deterministically. Caller mappings and raw condition tokens are reserved to prevent collisions.
- Existing raw expressions and mappings remain supported for compatibility and more elaborate expression compositions. Structured `updates` never requires them. Combined substitution-value size and compatibility with existing item types remain service validations.

See [AWS update expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html) for service semantics and [write conditions](./write-conditions.md) for conditional updates.
