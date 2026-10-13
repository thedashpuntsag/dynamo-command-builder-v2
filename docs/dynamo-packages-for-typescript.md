# AWS SDK v3: `@aws-sdk/client-dynamodb` vs `@aws-sdk/lib-dynamodb`

> Technical reference for TypeScript, Node.js, AWS Lambda, and DynamoDB.

## 1. Overview

AWS SDK for JavaScript v3 offers two primary approaches for DynamoDB:

- **`@aws-sdk/client-dynamodb`**: Low-level client that works with DynamoDB's explicit `AttributeValue` objects.
- **`@aws-sdk/lib-dynamodb`**: Higher-level Document Client that works with ordinary JavaScript values and performs conversions automatically.

Both call the same DynamoDB service. Using the Document Client does not change DynamoDB's underlying indexing, capacity consumption, or pricing for equivalent operations and data.

## 2. Feature comparison

| Feature                             | `@aws-sdk/client-dynamodb`     | `@aws-sdk/lib-dynamodb`             |
| ----------------------------------- | ------------------------------ | ----------------------------------- |
| Abstraction                         | Low-level                      | High-level                          |
| Input representation                | DynamoDB `AttributeValue`      | Native JavaScript values            |
| Output representation               | DynamoDB `AttributeValue`      | Native JavaScript values            |
| Automatic marshalling/unmarshalling | No                             | Yes                                 |
| CRUD / Query / Scan                 | Yes                            | Yes                                 |
| Batch / Transactions                | Yes                            | Yes                                 |
| Table administration                | Yes                            | Use the underlying low-level client |
| Conversion control                  | Explicit                       | Configurable                        |
| Application code complexity         | Higher                         | Usually lower                       |
| DynamoDB charges                    | Same for equivalent operations | Same for equivalent operations      |

`@aws-sdk/lib-dynamodb` wraps a `DynamoDBClient`; it is not a separate network driver.

## 3. Installation

Install both packages to use the Document Client:

```bash
pnpm add @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
```

For manual conversion with the low-level client:

```bash
pnpm add @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb
```

## 4. Create the clients

### Low-level client

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

export const client = new DynamoDBClient({
  region: 'ap-southeast-1',
});
```

### Document Client

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({
  region: 'ap-southeast-1',
});

export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
    convertClassInstanceToMap: false,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});
```

Reuse these clients across requests (for example, initialize them outside AWS Lambda handlers).

## 5. Put an item

### Low-level

```typescript
import { PutItemCommand } from '@aws-sdk/client-dynamodb';

await client.send(
  new PutItemCommand({
    TableName: 'users',
    Item: {
      id: { S: 'user-001' },
      name: { S: 'John' },
      age: { N: '25' },
      active: { BOOL: true },
      roles: { L: [{ S: 'ADMIN' }, { S: 'USER' }] },
    },
  })
);
```

### Document Client

```typescript
import { PutCommand } from '@aws-sdk/lib-dynamodb';

await docClient.send(
  new PutCommand({
    TableName: 'users',
    Item: {
      id: 'user-001',
      name: 'John',
      age: 25,
      active: true,
      roles: ['ADMIN', 'USER'],
    },
  })
);
```

The Document Client handles the conversion to DynamoDB attribute types.

## 6. Get an item

### Low-level

```typescript
import { GetItemCommand } from '@aws-sdk/client-dynamodb';

const result = await client.send(
  new GetItemCommand({
    TableName: 'users',
    Key: { id: { S: 'user-001' } },
  })
);

console.log(result.Item);
// { id: { S: 'user-001' }, name: { S: 'John' }, age: { N: '25' } }
```

### Document Client

```typescript
import { GetCommand } from '@aws-sdk/lib-dynamodb';

const result = await docClient.send(
  new GetCommand({
    TableName: 'users',
    Key: { id: 'user-001' },
  })
);

console.log(result.Item);
// { id: 'user-001', name: 'John', age: 25 }
```

## 7. Query a Global Secondary Index (GSI)

Assume the table has a GSI named `status-createdAt-index` with `status` as the partition key and `createdAt` as the sort key. In this example, `createdAt` is an ISO-8601 string.

### Low-level

```typescript
import { QueryCommand } from '@aws-sdk/client-dynamodb';

const result = await client.send(
  new QueryCommand({
    TableName: 'orders',
    IndexName: 'status-createdAt-index',
    KeyConditionExpression: '#status = :status AND #createdAt >= :date',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#createdAt': 'createdAt',
    },
    ExpressionAttributeValues: {
      ':status': { S: 'COMPLETED' },
      ':date': { S: '2026-01-01' },
    },
  })
);
```

### Document Client

```typescript
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

const result = await docClient.send(
  new QueryCommand({
    TableName: 'orders',
    IndexName: 'status-createdAt-index',
    KeyConditionExpression: '#status = :status AND #createdAt >= :date',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#createdAt': 'createdAt',
    },
    ExpressionAttributeValues: {
      ':status': 'COMPLETED',
      ':date': '2026-01-01',
    },
  })
);
```

**Important:** `QueryCommand` exists in both packages. Its input and output representations depend on **which package you import it from**. Both use the same DynamoDB query semantics, including filter behavior, pagination, and capacity rules.

## 8. Command mapping

| Low-level                   | Document Client        |
| --------------------------- | ---------------------- |
| `PutItemCommand`            | `PutCommand`           |
| `GetItemCommand`            | `GetCommand`           |
| `UpdateItemCommand`         | `UpdateCommand`        |
| `DeleteItemCommand`         | `DeleteCommand`        |
| `QueryCommand`              | `QueryCommand`         |
| `ScanCommand`               | `ScanCommand`          |
| `BatchGetItemCommand`       | `BatchGetCommand`      |
| `BatchWriteItemCommand`     | `BatchWriteCommand`    |
| `TransactGetItemsCommand`   | `TransactGetCommand`   |
| `TransactWriteItemsCommand` | `TransactWriteCommand` |

Table operations such as `CreateTableCommand` and `UpdateTableCommand` remain low-level operations.

## 9. Manual marshalling and unmarshalling

`@aws-sdk/util-dynamodb` supplies the conversion utilities `marshall()` and `unmarshall()`.

```typescript
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({ region: 'ap-southeast-1' });

await client.send(
  new PutItemCommand({
    TableName: 'users',
    Item: marshall({ id: 'user-001', name: 'John', age: 25 }),
  })
);

const result = await client.send(
  new GetItemCommand({
    TableName: 'users',
    Key: marshall({ id: 'user-001' }),
  })
);

const user = result.Item ? unmarshall(result.Item) : undefined;
```

This gives a low-level command JavaScript-friendly data, but conversion is **your responsibility**, including expression values and response items. Do not pre-marshall values passed to the Document Client; it marshals them itself.

## 10. Important Document Client options

| Option                      | Effect                                                               |
| --------------------------- | -------------------------------------------------------------------- |
| `removeUndefinedValues`     | Omits `undefined` values during marshalling                          |
| `convertEmptyValues`        | Converts supported empty values to DynamoDB `NULL`                   |
| `convertClassInstanceToMap` | Enables conversion of class instances to maps                        |
| `wrapNumbers`               | Controls how numbers are unmarshalled; useful when precision matters |

Example:

```typescript
const user = {
  id: 'user-001',
  name: 'John',
  phone: undefined,
};
```

With `removeUndefinedValues: true`, `phone` is omitted from a marshalled item. **Omitting a field from an update is not the same as deleting a stored attribute**; use a DynamoDB `REMOVE` update expression when deletion is intended.

### Number precision

JavaScript `number` cannot represent every integer or decimal exactly. For exact numeric values, use SDK-supported number handling (such as `NumberValue`) or an appropriate decimal strategy:

```typescript
import { NumberValue } from '@aws-sdk/lib-dynamodb';

const payment = {
  id: 'payment-001',
  amount: NumberValue.from('123456789.123456789'),
};
```

Avoid converting an exact decimal string to a JavaScript `number` before storing it if the conversion would lose precision.

## 11. Performance and cost

### CPU and latency

The Document Client has automatic conversion overhead. However, a low-level application that calls `marshall()` / `unmarshall()` performs similar work. The actual end-to-end performance difference depends on item size, request volume, bundling, runtime, and network latency.

No universal performance winner can be claimed without benchmarking the specific workload.

### DynamoDB billing

For equivalent requests and stored data, both approaches incur the **same DynamoDB read/write capacity and storage charges**. The Document Client does not inherently make an extra DynamoDB request.

### AWS Lambda

For Lambda deployments, measure:

- Cold-start initialization time and dependency bundle size.
- Warm-invocation duration.
- CPU spent on conversion for large items/batches.
- Memory use and total Lambda cost.

The Document Client is usually a good productivity default, but performance-sensitive paths should be benchmarked.

## 12. DynamoDB condition expressions and validation

Consider this conditional put:

```typescript
{
  ConditionExpression: '#status = :expectedStatus',
  ExpressionAttributeNames: {
    '#status': 'accountStatus',
  },
  ExpressionAttributeValues: {
    ':expectedStatus': 'PENDING',
  },
}
```

Here, `#status` refers to the stored attribute **`accountStatus`**, not necessarily an attribute in the new `Item`. For `PutItem`, a condition is evaluated against the existing item with the specified key. Therefore, **a local command builder should not reject this expression simply because `accountStatus` is absent from the new item**.

Both clients follow this same condition-expression behavior. Validate the expression syntax and placeholders separately from your application's business rules.

## 13. Suggested monorepo architecture

```text
packages/
└── aws-dynamodb/
    └── src/
        ├── client/
        │   ├── dynamodb-client.ts
        │   └── document-client.ts
        ├── commands/
        │   ├── get.ts
        │   ├── put.ts
        │   ├── update.ts
        │   ├── query.ts
        │   └── batch-get.ts
        ├── schemas/
        └── index.ts
```

Create a single low-level client:

```typescript
// client/dynamodb-client.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

export const dynamodbClient = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'ap-southeast-1',
});
```

Wrap it for application commands:

```typescript
// client/document-client.ts
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { dynamodbClient } from './dynamodb-client';

export const documentClient = DynamoDBDocumentClient.from(dynamodbClient, {
  marshallOptions: { removeUndefinedValues: true },
});
```

### Command-builder contract

**Choose a consistent representation for each builder:**

- A builder returning low-level `GetItemCommandInput` must use `AttributeValue` maps.
- A builder returning Document Client `GetCommandInput` must use native JavaScript values.
- Avoid mixing the representations or double-marshalling.

## 14. Decision guide

| Use case                                                   | Recommendation             |
| ---------------------------------------------------------- | -------------------------- |
| Typical Lambda CRUD API                                    | `@aws-sdk/lib-dynamodb`    |
| Next.js backend database access                            | `@aws-sdk/lib-dynamodb`    |
| Query, scan, batch and transaction business logic          | `@aws-sdk/lib-dynamodb`    |
| DynamoDB table/index administration                        | `@aws-sdk/client-dynamodb` |
| Generic builders that emit raw DynamoDB API requests       | `@aws-sdk/client-dynamodb` |
| Custom serialization and explicit `AttributeValue` control | `@aws-sdk/client-dynamodb` |
| Very high-volume batch conversion                          | Benchmark both             |

**Default recommendation:** Use `@aws-sdk/lib-dynamodb` for application operations, and keep `@aws-sdk/client-dynamodb` for low-level administration or library code requiring raw DynamoDB representations.

## 15. Official references

- [AWS DynamoDB JavaScript programming](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/programming-with-javascript.html)
- [AWS SDK v3 Document Client API](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-dynamodb/)
- [DynamoDB Document Client migration guide](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-dynamodb-doc-client.html)
- [AWS SDK v3 DynamoDB code examples](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_dynamodb_code_examples.html)
