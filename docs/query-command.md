# Query Command

`buildValidatedQueryCommand` creates an AWS SDK v3 DocumentClient `QueryCommandInput` without requiring a table, index, or entity definition.

```ts
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildValidatedQueryCommand } from 'dynamo-command-builder-v2';

const input = buildValidatedQueryCommand({
  tableName: 'Orders',
  indexName: 'byTenantAndDate',
  partitionKeys: {
    tenantId: 'tenant-1',
    region: 'MN',
  },
  sortKeys: {
    year: 2026,
    createdAt: { between: [100, 200] },
  },
  filters: {
    status: 'ACTIVE',
    total: { gte: 1000 },
  },
  attributes: ['orderId', 'status', 'total'],
});

const result = await documentClient.send(new QueryCommand(input));
```

## Selecting returned attributes

The `attributes` array specifies which item fields DynamoDB should return. The builder converts these paths into a collision-safe DynamoDB `ProjectionExpression` and `ExpressionAttributeNames` map.

```ts
const input = buildValidatedQueryCommand({
  tableName: 'Orders',
  partitionKeys: {
    customerId: 'customer-1',
  },
  attributes: ['orderId', 'status', 'total', 'createdAt'],
});
```

The generated command input contains a projection similar to:

```ts
{
  ProjectionExpression:
    '#projection0_0, #projection1_0, #projection2_0, #projection3_0',
  ExpressionAttributeNames: {
    '#projection0_0': 'orderId',
    '#projection1_0': 'status',
    '#projection2_0': 'total',
    '#projection3_0': 'createdAt',
  },
}
```

### Nested map properties

Use dot notation to select a property inside a DynamoDB map:

```ts
attributes: ['orderId', 'customer.name', 'customer.address.city'];
```

A matching returned item has approximately this shape:

```ts
{
  orderId: 'order-1',
  customer: {
    name: 'Dash',
    address: {
      city: 'Ulaanbaatar',
    },
  },
}
```

### List elements

Use a numeric bracket segment to select a particular list element:

```ts
attributes: ['items[0].sku', 'items[0].quantity'];
```

### Validation

Every entry must be a non-empty attribute path.

Valid paths:

```ts
attributes: ['orderId', 'customer.name', 'items[0].sku'];
```

Invalid paths:

```ts
attributes: ['', '.customer', 'customer.', 'items[]', 'items[abc]'];
```

Duplicate paths are removed automatically. For example, `['status', 'status', 'total']` behaves like `['status', 'total']`.

### Projection and filters

`filters` and `attributes` have different responsibilities:

```ts
{
  filters: {
    status: 'ACTIVE',
  },
  attributes: ['orderId', 'status', 'total'],
}
```

- `filters` controls which evaluated items are returned.
- `attributes` controls which fields are present on each returned item.

A projection does not reduce read-capacity consumption. DynamoDB reads each item before applying the projection.

### Projection and `select`

When `attributes` is provided, omit `select` or set it to `SPECIFIC_ATTRIBUTES`:

```ts
{
  attributes: ['orderId', 'status'],
  select: 'SPECIFIC_ATTRIBUTES',
}
```

Other selection modes conflict with a projection:

```ts
// Invalid
{
  attributes: ['orderId'],
  select: 'COUNT',
}
```

In most cases, omit `select` and let the builder generate the projection.
