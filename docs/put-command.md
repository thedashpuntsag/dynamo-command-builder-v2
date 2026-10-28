# Put conditions

`buildValidatedPutCommand` builds a DocumentClient input. Conditions test the **existing item**, before the new item replaces it. A failed condition causes DynamoDB to reject the write.

The same syntax is supported by Update, Delete, and transactional writes; see [write conditions](./write-conditions.md).

## Attribute conditions

A condition names an `attr` and exactly one operator. Create an item only if its key does not exist:

```typescript
buildValidatedPutCommand({
  tableName: 'Users',
  item: { id: 'user-1', name: 'Dash' },
  condition: { attr: 'id', notExists: true },
});
```

Equality and prefix checks use values directly:

```typescript
condition: { attr: 'status', eq: 'PENDING' }
// Or:
condition: { attr: 'status', beginsWith: 'PENDING' }
```

Supported operators:

| Operator                             | Example                                        |
| ------------------------------------ | ---------------------------------------------- |
| `eq`, `ne`, `lt`, `lte`, `gt`, `gte` | `{ attr: 'version', gte: 3 }`                  |
| `between`                            | `{ attr: 'version', between: [1, 3] }`         |
| `in`                                 | `{ attr: 'status', in: ['READY', 'PENDING'] }` |
| `beginsWith`                         | `{ attr: 'id', beginsWith: 'order-' }`         |
| `contains`, `notContains`            | `{ attr: 'tags', contains: 'priority' }`       |
| `exists`, `notExists`                | `{ attr: 'deletedAt', notExists: true }`       |
| `type`                               | `{ attr: 'metadata', type: 'M' }`              |
| `size`                               | `{ attr: 'attachments', size: { gt: 0 } }`     |

`size` accepts comparisons, `between`, or `in`. Map equality is unambiguous: `{ attr: 'metadata', eq: { source: 'API' } }`. Values are always literal values, so `{ eq: { path: 'other' } }` compares to a map, not another attribute. Use a raw expression for attribute-to-attribute comparisons.

## Nested logic

Combine leaves with `and`, `or`, and `not`. Logical `and`/`or` groups require at least two children. Each child is a complete condition object, so the same attribute can appear more than once:

```typescript
buildValidatedPutCommand({
  tableName: 'Orders',
  item: { id: 'order-1', version: 4, status: 'CONFIRMED' },
  condition: {
    and: [
      { attr: 'version', eq: 3 },
      {
        or: [
          { attr: 'status', eq: 'PENDING' },
          { attr: 'status', beginsWith: 'APPROVED' },
        ],
      },
      { attr: 'deletedAt', notExists: true },
      { not: { attr: 'tags', contains: 'blocked' } },
      { attr: 'items', size: { gte: 1 } },
      { attr: 'items[0].sku', beginsWith: 'SKU-' },
    ],
  },
  returnValuesOnConditionCheckFailure: 'ALL_OLD',
});
```

Paths use dots for map traversal and brackets for list indexes. Every segment is aliased automatically. Literal attribute names containing dots or brackets require a raw expression with explicit aliases.

## Record shorthand

The optional `conditions` record remains available for simple checks. Entries join with `AND`; set `conditionJoin: 'OR'` to use `OR`:

```typescript
conditions: { version: 3, deletedAt: { notExists: true } }
```

Direct scalar, binary, list, and set values mean equality. Wrap map equality explicitly: `metadata: { eq: { source: 'API' } }`.

## Validation and raw expressions

Choose exactly one of `condition`, `conditions`, and raw `conditionExpression`. Existing `expressionAttributeNames` and `expressionAttributeValues` are only accepted with raw expressions. `conditionJoin` only applies to `conditions`.

Undefined, nonfinite numbers, cyclic values, empty sets, and heterogeneous sets are rejected. Structured conditions enforce 1–100 `IN` operands, at most 32 path dereferences, a 4 KB expression limit, and a 300-operator/function budget. They validate shape and values, not compatibility with the existing item's types. DynamoDB performs service-side validation and condition evaluation. Combined substitution-value size is not currently calculated locally.

See the [AWS condition grammar](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.OperatorsAndFunctions.html) for evaluation semantics.
