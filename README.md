# dynamo-command-builder-v2

A type-safe command builder for the AWS SDK for JavaScript v3 DynamoDB clients.

> This package is under active development and does not yet expose a public API.

## Requirements

- Node.js 22.13 or newer for development (Node.js 20 remains supported for package consumers)
- pnpm 11

## Development

```bash
pnpm install
pnpm check
```

The `check` command verifies formatting, linting, types, tests, and the production build.

Integration tests can run against the included in-memory DynamoDB Local service. See [Testing with DynamoDB Local](./docs/local-test.md) for setup, configuration, and cleanup instructions.

## Documentation

- [Query Command](./docs/query-command.md) — schema-free queries, structured filters, and projected attributes
- [Structured condition expression design](./docs/condition-expression-design.md) — proposed complete condition AST and migration plan
- [DynamoDB packages for TypeScript](./docs/dynamo-packages-for-typescript.md)
- [Testing with DynamoDB Local](./docs/local-test.md)

## License

[MIT](./LICENSE)
