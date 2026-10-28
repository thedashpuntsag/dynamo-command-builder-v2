# dynamo-craft

Type-safe command builders for the AWS SDK for JavaScript v3 DynamoDB DocumentClient, with a local React playground for trying every command against real test data.

Builders validate parameters and return SDK command inputs. Execute those inputs with `@aws-sdk/lib-dynamodb`, or inspect them in the playground before sending a request.

> This project is under active development; its API may change.

## Requirements

- Node.js 22.13 or newer for development; the library targets Node.js 20 or newer
- Vite+ CLI (`vp`)
- pnpm 12.3.4, as declared in `package.json`
- Docker with Compose for DynamoDB Local and the playground's database operations

## Quick start

Run these commands from the repository root:

```bash
vp install
vp run local:dynamo:start
vp run local:dynamo:seed
vp run playground
```

Open the playground at <http://127.0.0.1:5173>. DynamoDB Local runs at <http://localhost:8000>, and DynamoDB Admin is available at <http://localhost:8001>. No AWS account or real credentials are required.

## Command playground

Choose a command from the welcome page or sidebar. Edit its parameters on the right and inspect the results on the left.

- **Seeded table** loads an expanded example for the local table. **All fields** includes optional parameters and notes about schema requirements or mutually exclusive fields.
- **Build only** validates parameters and shows the generated SDK input without contacting DynamoDB.
- **Run command** executes against the local table. Use `Cmd+Enter` or `Ctrl+Enter` inside the editor as a shortcut.
- **Response / Built SDK input** switches between the database response and the input produced by the builder.
- **Format / Reset example** formats the current object or restores the selected preset. Drafts persist per command and table in browser local storage.

The editor presents inputs as `const input = { ... };` and accepts JSON5-compatible object data, including comments, single quotes, unquoted keys, and trailing commas. Use tagged objects for native DynamoDB sets and binary values:

```js
{
  tags: { $set: ['local', 'ready'] },
  checkpoints: { $set: [0, 1, 2] },
  payload: { $binary: 'SGVsbG8=' }, // Base64 bytes for "Hello".
}
```

Read examples use seeded `local-test-*` IDs. Write examples use `playground-*` IDs and modify the local database. Some all-fields presets demonstrate alternative schemas; read their notes before running them.

See the [playground README](./test/playground/README.md) for its source layout and the [local testing guide](./docs/local-test.md) for detailed usage.

## Seeded table and indexes

The seed creates `command-builder-test` with a string `id` partition key and writes 50 deterministic items. Items contain nested maps and lists, string and number sets, binary payloads, Unicode, nulls, empty values, and attribute names that require expression aliases.

It also creates these global secondary indexes:

| Index                    | Partition key     | Sort key             | Projection |
| ------------------------ | ----------------- | -------------------- | ---------- |
| `status-createdAt-index` | `status` (string) | `createdAt` (number) | `ALL`      |
| `pk1-sk1-index`          | `pk1` (string)    | `sk1` (string)       | `ALL`      |
| `pk2-sk2-index`          | `pk2` (string)    | `sk2` (string)       | `ALL`      |
| `pk3-sk3-index`          | `pk3` (string)    | `sk3` (string)       | `ALL`      |
| `pk4-sk4-index`          | `pk4` (string)    | `sk4` (string)       | `ALL`      |

Re-running the seed adds any missing indexes to an existing table, replaces the 50 seeded items, and preserves other items. It waits for every index to become active, verifies full item read-backs, and queries both `READY` and `PENDING` groups in timestamp order.

The playground's runnable Query preset uses `pk4-sk4-index`; the Query and Scan all-fields presets use `status-createdAt-index`. The default read presets use structured filters and attribute paths so the builders generate DynamoDB expressions and mappings. GSI requests use `consistentRead: false`. After updating an existing checkout, re-run the seed and restart the playground; load a preset to replace an older saved draft.

## Command builders

The package exports builders for Get, Put, Update, Delete, Query, Scan, Batch Get, Batch Write, Transact Get, and Transact Write. Inputs use native JavaScript values for items, keys, and expression values.

For example, build a query against the seeded index:

```typescript
import { buildValidatedQueryCommand } from 'dynamo-craft';

const input = buildValidatedQueryCommand({
  tableName: 'command-builder-test',
  indexName: 'status-createdAt-index',
  partitionKeys: { status: 'READY' },
  sortKeys: { createdAt: { gte: 1_798_000_000_000 } },
  attributes: ['id', 'status', 'createdAt'],
  limit: 10,
  consistentRead: false,
  scanIndexForward: true,
  returnConsumedCapacity: 'TOTAL',
});
```

Pass `input` to `new QueryCommand(input)` from `@aws-sdk/lib-dynamodb`, then send it through a configured `DynamoDBDocumentClient`. See the [Query guide](./docs/query-command.md) for filters, projections, expressions, and pagination, and the [local testing guide](./docs/local-test.md) for local connection settings.

## Configuration and database commands

Copy `.env.example` to `.env` to customize `DYNAMODB_LOCAL_ENDPOINT` and `DYNAMODB_LOCAL_TABLE`. The playground loads the repository-root `.env` automatically. For seed and clear scripts, export its values first:

```bash
cp .env.example .env
set -a; source .env; set +a
```

| Command                     | Purpose                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| `vp run local:dynamo:start` | Start DynamoDB Local and DynamoDB Admin                                          |
| `vp run local:dynamo:seed`  | Create or update the table and index, seed items, and verify reads               |
| `vp run local:dynamo:clear` | Delete all items from the configured table, retaining its table and index schema |
| `vp run local:dynamo:logs`  | Stream service logs                                                              |
| `vp run local:dynamo:stop`  | Stop the services                                                                |
| `vp run local:dynamo:down`  | Remove containers and the network, retaining database storage                    |

Docker volumes preserve data across restarts and `local:dynamo:down`. Clearing the table removes its items; re-seed to restore the examples.

## Development and validation

```bash
vp check
vp test run
vp run typecheck
vp run build
vp run playground:typecheck
vp run playground:build
```

`vp check` is the Vite+ formatting, lint, and type check command. `vp run check` runs this repository's aggregate script, which also runs library tests and builds the library.

With the playground and seeded database running, run the integration smoke check:

```bash
vp run playground:smoke
```

It builds and executes both presets for all ten commands, verifies structured update/condition behavior, and cleans up its temporary writes. The composite-key Batch Write reference uses a temporary table with its required schema, which is deleted afterward. Use `PLAYGROUND_URL` to target a playground running on another local port.

To serve the built playground with its local API, stop the development server and run `vp run playground:preview`. Restart the playground after changing server-side source or environment settings.

## Documentation

- [Local testing and playground guide](./docs/local-test.md)
- [Playground project layout](./test/playground/README.md)
- [Structured update operations](./docs/update-command.md)
- [Write conditions: Update, Delete, and transactions](./docs/write-conditions.md)
- [Put conditions](./docs/put-command.md)
- [Query command](./docs/query-command.md)
- [Structured condition expression design](./docs/condition-expression-design.md)
- [DynamoDB packages for TypeScript](./docs/dynamo-packages-for-typescript.md)

## License

[MIT](./LICENSE)
