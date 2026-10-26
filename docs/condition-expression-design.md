# Structured Condition Expression Design

## Status

Design proposal. This document defines the intended API and compiler behavior before implementation.

## Objective

Allow Put, Update, Delete, transactional writes, Query filters, and Scan filters to express DynamoDB conditions without manually writing:

- `ConditionExpression` or `FilterExpression`
- `ExpressionAttributeNames`
- `ExpressionAttributeValues`
- legacy `extraExpAttributeNames` or `extraExpAttributeValues`

The library must remain schema-free: callers provide paths and values directly, and the compiler returns ordinary AWS SDK v3 DocumentClient command input.

Raw expressions remain an escape hatch, but the structured API should represent the complete modern DynamoDB condition grammar.

## DynamoDB surface that must be covered

The compiler must support:

- Comparators: `=`, `<>`, `<`, `<=`, `>`, and `>=`
- `BETWEEN`
- `IN`, with at most 100 operands
- `attribute_exists(path)`
- `attribute_not_exists(path)`
- `attribute_type(path, type)`
- `begins_with(path, value)`
- `contains(path, value)`
- `size(path)` as an operand
- Nested `AND`, `OR`, and `NOT`
- Explicit grouping and precedence
- Top-level and nested document paths
- List indexes such as `items[0].sku`
- Comparisons involving values, paths, and `size(path)` operands

AWS references:

- [Condition expression grammar](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.OperatorsAndFunctions.html)
- [Condition expression examples](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [Document paths](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.Attributes.html)
- [Expression limits](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html)
- [Reserved words](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ReservedWords.html)

## Why one flat object is insufficient

This shorthand is useful:

```ts
conditions: {
  status: 'ACTIVE',
  version: { gte: 3 },
  deletedAt: { notExists: true },
}
```

However, it cannot unambiguously represent this expression:

```text
(status = "ACTIVE" OR status = "PENDING")
AND NOT (ownerId = blockedOwnerId)
AND size(tags) >= 2
```

It also cannot naturally place two independent conditions on the same path. Therefore, the public design needs two layers:

1. A concise record shorthand for common conditions.
2. A complete recursive condition AST for all DynamoDB cases.

Both forms compile through one shared expression compiler.

## Proposed complete AST

### Operands

```ts
type ConditionSubject = { path: string } | { size: string };

type ConditionOperand = ConditionSubject | { value: unknown };
```

Examples:

```ts
{
  value: 10;
}
{
  path: 'inventory.available';
}
{
  size: 'tags';
}
```

Values are always converted into generated `:valueN` placeholders. Paths are always segmented and converted into generated `#nameN` placeholders.

### Conditions

```ts
type CompareOperator = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';

type DynamoAttributeType = 'S' | 'SS' | 'N' | 'NS' | 'B' | 'BS' | 'BOOL' | 'NULL' | 'L' | 'M';

type Condition =
  | {
      compare: {
        left: ConditionSubject;
        operator: CompareOperator;
        right: ConditionOperand;
      };
    }
  | {
      between: {
        operand: ConditionSubject;
        lower: ConditionOperand;
        upper: ConditionOperand;
      };
    }
  | {
      in: {
        operand: ConditionSubject;
        values: readonly ConditionOperand[];
      };
    }
  | { exists: string }
  | { notExists: string }
  | { attributeType: { path: string; type: DynamoAttributeType } }
  | { beginsWith: { path: string; value: ConditionOperand } }
  | { contains: { path: string; value: ConditionOperand } }
  | { and: readonly Condition[] }
  | { or: readonly Condition[] }
  | { not: Condition };
```

Each object is a discriminated single-operation node. Unknown properties and objects containing multiple operations are rejected.

### Full example

```ts
const condition: Condition = {
  and: [
    {
      or: [
        {
          compare: {
            left: { path: 'status' },
            operator: 'eq',
            right: { value: 'ACTIVE' },
          },
        },
        {
          compare: {
            left: { path: 'status' },
            operator: 'eq',
            right: { value: 'PENDING' },
          },
        },
      ],
    },
    {
      compare: {
        left: { size: 'tags' },
        operator: 'gte',
        right: { value: 2 },
      },
    },
    {
      not: {
        compare: {
          left: { path: 'ownerId' },
          operator: 'eq',
          right: { path: 'blockedOwnerId' },
        },
      },
    },
  ],
};
```

Generated expression:

```text
((#n0 = :v0) OR (#n0 = :v1))
AND (size(#n1) >= :v2)
AND (NOT (#n2 = #n3))
```

The compiler adds parentheses around logical child nodes so output does not depend on DynamoDB's implicit precedence rules.

## Concise record shorthand

Common conditions should remain easy to write:

```ts
type ConditionRecord = Record<string, ConditionRecordValue>;

type ConditionRecordValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | Uint8Array
  | readonly unknown[]
  | ReadonlySet<unknown>
  | { eq: unknown }
  | { ne: unknown }
  | { lt: unknown }
  | { lte: unknown }
  | { gt: unknown }
  | { gte: unknown }
  | { between: readonly [unknown, unknown] }
  | { in: readonly unknown[] }
  | { beginsWith: string | Uint8Array }
  | { contains: unknown }
  | { notContains: unknown }
  | { type: DynamoAttributeType }
  | { exists: true }
  | { notExists: true }
  | { size: SizeCondition };
```

Example:

```ts
conditions: {
  status: { in: ['ACTIVE', 'PENDING'] },
  version: { gte: 3 },
  tags: { contains: 'priority' },
  metadata: { type: 'M' },
  attachments: { size: { gt: 0 } },
  deletedAt: { notExists: true },
}
```

The default join is `AND`:

```ts
conditionJoin: 'AND';
```

`OR` is also available for a flat record:

```ts
conditionJoin: 'OR';
```

Complex mixed grouping must use the complete AST instead of adding more flags to the shorthand.

### Equality and object values

Direct scalar, list, and set values mean equality:

```ts
conditions: {
  status: 'ACTIVE',
  enabled: true,
  labels: ['priority', 'external'],
}
```

DynamoDB map values are ambiguous with operator objects. Map equality must therefore use an explicit wrapper:

```ts
conditions: {
  metadata: {
    eq: {
      source: 'API',
      version: 2,
    },
  },
}
```

## Command API

Put, Update, and Delete should expose the same fields:

```ts
type StructuredConditionInput = {
  conditions?: ConditionRecord;
  conditionJoin?: 'AND' | 'OR';
  condition?: Condition;
};
```

Exactly one of `conditions`, `condition`, or raw `conditionExpression` may be supplied.

### Put

```ts
buildValidatedPutCommand({
  tableName: 'Users',
  item: { userId: 'user-1', email: 'dash@example.com' },
  conditions: {
    userId: { notExists: true },
  },
});
```

### Update with optimistic locking

```ts
buildValidatedUpdateCommand({
  tableName: 'Users',
  key: { userId: 'user-1' },
  item: {
    name: 'Dash',
    version: 4,
  },
  conditions: {
    version: 3,
  },
});
```

### Delete

```ts
buildValidatedDeleteCommandInput({
  tableName: 'Users',
  key: { userId: 'user-1' },
  condition: {
    and: [
      { exists: 'userId' },
      {
        compare: {
          left: { path: 'status' },
          operator: 'eq',
          right: { value: 'INACTIVE' },
        },
      },
    ],
  },
});
```

The same structured condition types should be reused by transactional Put, Update, Delete, and ConditionCheck operations. Query and Scan filters should use the same compiler but write the result to `FilterExpression`.

## Compiler result

The shared internal compiler should return:

```ts
type CompiledCondition = {
  expression: string;
  expressionAttributeNames: Record<string, string>;
  expressionAttributeValues: Record<string, unknown>;
  operatorCount: number;
};
```

Proposed internal function:

```ts
compileConditionExpression(
  condition: Condition | ConditionRecord,
  options?: {
    join?: 'AND' | 'OR';
    tokenNamespace?: string;
    occupiedNameTokens?: Iterable<string>;
    occupiedValueTokens?: Iterable<string>;
  },
): CompiledCondition
```

The compiler must be deterministic: identical inputs produce identical expressions and placeholder maps.

## Path compilation

Every path segment must be aliased, even when it is not reserved:

```ts
'profile.addresses[0].city';
```

becomes:

```text
#n0.#n1[0].#n2
```

with:

```ts
{
  '#n0': 'profile',
  '#n1': 'addresses',
  '#n2': 'city',
}
```

This automatically handles reserved words, spaces, dots contained in real attribute names, hyphens, repeated segments, and other special characters. Repeated path segments should reuse the same alias when doing so cannot create a conflict.

Because dot notation means map traversal, a literal attribute name containing a dot cannot be represented unambiguously by a string path. The complete path API should eventually support explicit segments:

```ts
{
  path: ['Safety.Warning'];
}
{
  path: ['items', 0, 'sku'];
}
```

The string form remains the ergonomic shorthand:

```ts
{
  path: 'items[0].sku';
}
```

Paths must reject negative or fractional indexes and more than 32 dereference operations.

## Placeholder behavior

- Names use a private namespace such as `#conditionName0`.
- Values use a private namespace such as `:conditionValue0`.
- Existing UpdateExpression tokens are reserved before compiling conditions.
- Token collisions are resolved deterministically with numeric suffixes.
- Equal values should not be deduplicated initially; identity-sensitive JavaScript values and binary buffers make safe deduplication complicated.
- Name aliases may be reused for identical path segments.
- Generated maps include only referenced placeholders.
- `undefined` values are rejected. `null` is a valid DynamoDB value.

## Validation requirements

Validation occurs before command input is returned.

### Structural validation

- Logical `and` and `or` arrays must contain at least two conditions.
- `not` must contain exactly one condition.
- Each condition node must contain exactly one recognized operation.
- `between` requires exactly two operands.
- `in.values` requires 1–100 operands.
- `exists` and `notExists` accept paths only.
- `attributeType.type` must be a supported DynamoDB type code.
- `beginsWith` accepts string or binary values.
- `contains` rejects a path operand identical to its target path.
- Empty sets are rejected; empty lists and maps remain valid values.
- JavaScript `undefined`, `NaN`, and infinite numbers are rejected recursively.
- Cyclic objects are rejected with a clear error.

### DynamoDB limits

The compiler should detect limits that can be calculated locally:

- Maximum expression UTF-8 size: 4 KB
- Maximum placeholder name or value token length: 255 bytes
- Maximum combined substitution-variable size: 2 MB where practical to calculate
- Maximum operators and functions: 300
- Maximum `IN` operands: 100
- Maximum document path dereferences: 32

Some value-type compatibility rules cannot be known without table or item metadata. Those remain DynamoDB service validations and must be documented as such.

## Raw expression interoperability

Raw expressions remain available for forward compatibility and uncommon syntax:

```ts
conditionExpression: 'size(#items) < :maximum',
expressionAttributeNames: {
  '#items': 'items',
},
expressionAttributeValues: {
  ':maximum': 10,
},
```

Rules:

1. Structured and raw conditions are mutually exclusive in the first implementation.
2. Standard `expressionAttributeNames` and `expressionAttributeValues` remain available only with raw expressions.
3. Generated expressions never require callers to provide placeholder maps.
4. A later version may support explicit composition of raw leaf nodes inside the AST, but only if token scopes can be merged safely.

## Migration and deprecation

### Add

- `conditions`
- `conditionJoin`
- `condition`
- Shared `compileConditionExpression` utility

### Deprecate immediately

- `extraExpAttributeNames`
- `extraExpAttributeValues`

These fields duplicate the standard AWS expression maps and create unclear precedence rules.

### Keep as escape hatch

- `conditionExpression`
- `expressionAttributeNames`
- `expressionAttributeValues`

### Remove in the next major release

- `extraExpAttributeNames`
- `extraExpAttributeValues`

No automatic migration should attempt to parse arbitrary raw DynamoDB expressions back into the structured AST.

## Implementation sequence

1. Implement and exhaustively test the document-path parser.
2. Implement the complete AST schemas and TypeScript types.
3. Implement the deterministic condition compiler independently of commands.
4. Add expression-size and operator-count validation.
5. Add record shorthand normalization into the complete AST.
6. Integrate with Put and Delete.
7. Integrate with Update while sharing a token scope with generated update expressions.
8. Integrate with transactional write operations.
9. Replace the Query and Scan structured-filter implementation with the shared compiler.
10. Deprecate the `extra*` mappings and publish a migration guide.

## Test matrix

At minimum, tests must cover:

- Every comparator and function
- `IN` with 1 and 100 values, plus rejection at 0 and 101
- Nested `AND`, `OR`, and `NOT`
- Precedence-sensitive groups
- Path-to-value, path-to-path, and size-to-value comparisons
- Every DynamoDB attribute type code
- Null versus missing attributes
- Strings, numbers, bigint values, binary values, lists, maps, and sets
- Empty and invalid values
- Reserved words and special-character attribute names
- Nested maps and lists at depth 32 and rejection at depth 33
- Duplicate path segments and alias reuse
- Placeholder collisions with update expressions and raw mappings
- Expression size and 300-operator boundaries
- Put, Update, Delete, ConditionCheck, Query filter, and Scan filter integration
- Deterministic output snapshots
- DynamoDB Local integration tests for supported semantics

## Decision summary

The implementation should not expand the current flat filter object until it becomes an accidental expression language. The durable design is:

- A complete recursive AST matching DynamoDB's grammar
- A concise record shorthand for the common case
- One deterministic shared compiler
- Automatic path aliases and value placeholders
- Raw expressions retained as a mutually exclusive escape hatch
- Legacy `extra*` mappings deprecated and later removed
