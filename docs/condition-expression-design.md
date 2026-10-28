# Structured condition expression design

## Status and scope

Implemented for Put, Update, Delete, and all transactional write operations, including ConditionCheck. See [write conditions](./write-conditions.md) and [condition operators](./put-command.md). Query and Scan retain their existing filter APIs.

## Public API

Use attribute-based leaves with literal values:

```typescript
condition: { attr: 'status', beginsWith: 'PENDING' }
condition: { attr: 'status', eq: 'PENDING' }
condition: {
  and: [
    { attr: 'status', eq: 'PENDING' },
    { attr: 'version', gte: 3 },
  ],
}
```

Each leaf contains `attr` and exactly one operator. Logical nodes contain exactly one of `and`, `or`, or `not`. Leaves cannot also contain logical groups. `and`/`or` require at least two children; `not` takes one condition.

The previous verbose `compare: { left, operator, right }` and operand-wrapper proposal has been replaced by this syntax. Operator values are always literal DynamoDB values. Attribute-to-attribute comparisons remain available through raw expressions.

Leaf operators are `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `between`, `in`, `beginsWith`, `contains`, `notContains`, `exists`, `notExists`, `type`, and `size`. `size` takes a comparison, range, or membership operation. Existence checks take `true`.

The optional `conditions` record shorthand normalizes into the same leaves. It supports an `AND`/`OR` `conditionJoin`. Exactly one of `condition`, `conditions`, or raw `conditionExpression` is accepted. Placeholder maps are accepted for raw condition expressions and for Update expressions; structured condition mappings are always generated.

## Compiler behavior

- Returns ordinary SDK DocumentClient expression inputs without executing requests.
- Generates deterministic `#conditionNameN` and `:conditionValueN` placeholders.
- Aliases every document path segment and reuses aliases for identical segments.
- Preserves explicit parentheses around logical children.
- Accepts string paths with dot traversal and nonnegative integer list indexes.
- Rejects malformed paths, more than 32 dereferences, invalid values, cyclic data, empty or heterogeneous sets, and ambiguous/multiple operations.
- Enforces 1–100 membership values, a 4 KB expression limit, and a conservative 300-operator/function budget.
- Does not calculate combined substitution-value size or validate types against existing item metadata.

Literal attribute names containing dots or brackets use raw expressions and explicit aliases. No parser attempts to reverse arbitrary raw expressions into structured conditions.

## Shared command integration

All write operations reuse the same condition fields, validation, and compiler. Update reserves supplied mappings and all update-expression tokens before compiling conditions. Standalone Update includes both generated update mappings and legacy mappings in this scope. Transactional operations keep independent token scopes per operation. ConditionCheck requires exactly one condition mode.

Query and Scan may reuse the compiler with `FilterExpression` output in a future change.

Future work may include explicit path segments for literal dotted names and combined substitution-size validation. These additions should preserve the concise attribute-based leaf syntax.
