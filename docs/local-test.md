# Testing with DynamoDB Local

This repository includes DynamoDB Local with persistent Docker storage, seed and clear scripts, and a React command playground. No AWS account or real credentials are required.

The playground lives in [`test/playground`](../test/playground/README.md), with React source in `src/`, backend code in `src/server/`, tests in `tests/`, and integration utilities in `scripts/`.

## Start the playground

You need the development requirements in the [README](../README.md#requirements) and Docker with Compose.

```bash
vp install
vp run local:dynamo:start
vp run local:dynamo:seed
vp run playground
```

Open <http://127.0.0.1:5173>. The welcome page links to all ten command builders: Get, Query, Scan, Put, Update, Delete, Batch Get, Batch Write, Transact Get, and Transact Write. Each command has its own URL, for example `/#/command/get`.

The seed creates `command-builder-test` if necessary and writes 50 deterministic items. Items include nested profiles, orders and workflow history, heterogeneous lists, string and number sets, binary payloads, nulls, empty values, Unicode, and attribute names containing dots and hyphens. The seed verifies every item with a full read-back comparison. It also creates `status-createdAt-index` plus four string-key GSIs named `pk1-sk1-index` through `pk4-sk4-index`, all with `ALL` projection. Existing tables get missing indexes without being recreated. The seed waits for every index to become active and verifies both status groups in timestamp order. Re-seeding replaces these 50 items; other items remain.

## Use the command workbench

- **Input on the right:** edit the builder parameters in a CodeMirror editor with line numbers and syntax highlighting. Drafts are saved per command and table in browser local storage.
- **Seeded table / All fields:** load an expanded runnable example or a complete field reference. Loading either preset replaces the current draft. Existing saved drafts are preserved until you load or reset an example.
- **Output on the left:** inspect the DynamoDB response or switch to **Built SDK input** to see exactly what the library generated.
- **Build only:** validate and build without contacting DynamoDB.
- **Run command:** invoke the public library builder, then send its generated input through the AWS SDK to DynamoDB Local. You can also press `Cmd+Enter` or `Ctrl+Enter` inside the editor.
- **Format / Reset example:** format the current object or restore the command's original example. Output can be copied with the copy button.

The **All fields** presets and their notes cover supported parameters, including mutually exclusive condition/update modes, nested batch and transaction fields, and response options. The write references deliberately demonstrate raw-expression compatibility; the Seeded table presets demonstrate structured conditions and updates. In particular:

- Query and Scan include `indexName` and `exclusiveStartKey`. The runnable Query preset uses `pk4-sk4-index`; their all-fields presets use `status-createdAt-index` and can run locally after re-seeding. The Query examples demonstrate structured key conditions and filters alongside raw expressions, ordering, limits, and projections. Both use eventually consistent reads because DynamoDB GSIs do not support strongly consistent reads.
- Batch Write includes a composite key (`id` + `version`) in its reference preset. The seeded table only has the `id` key.
- Update uses `updates` and nested `{ attr, operator: value }` conditions in its seeded preset. It demonstrates SET, REMOVE, ADD, and DELETE without manual mappings. The all-fields reference uses raw `updateExpression` and legacy extra mappings. Choose exactly one of `updates`, `item`, or `updateExpression`.
- Transact Write demonstrates PUT, UPDATE, DELETE, and CONDITION_CHECK on distinct items. The seeded preset uses structured conditions and updates; the all-fields reference retains raw-expression compatibility. Its reference preset adds `clientRequestToken`; choose a new token when changing a request.

**Reset example** restores the currently selected preset. Existing browser drafts are retained when examples change; load a preset explicitly to replace an older draft.

Inputs accept JSON or JSON5 object literal syntax, including comments, single quotes, unquoted property names, and trailing commas. Functions, imports, and arbitrary JavaScript expressions are not executed. Use these tagged objects for native DynamoDB types:

```js
{
  tableName: 'command-builder-test',
  item: {
    id: 'playground-item',
    tags: { $set: ['local', 'ready'] }, // Native string Set; must be non-empty.
    checkpoints: { $set: [0, 1, 2] }, // Native number Set.
    payload: { $binary: 'SGVsbG8=' }, // Binary bytes, encoded as base64: "Hello".
    details: { enabled: true, optional: null, history: [{ action: 'CREATED' }] },
  },
}
```

Responses and generated SDK inputs use the same tags to preserve sets and binary data. Maps and lists use normal object and array syntax.

Read examples target the seeded `local-test-*` items. Write examples use `playground-*` IDs and change real local data when run. The Update example can create `playground-item` even if Put has not been run. The transaction write example includes a condition check against `local-test-001`, so seed the table first.

The seeded Query preset uses `pk4-sk4-index`, which groups items by workflow state and sorts them by update time. The all-fields preset uses `status-createdAt-index`, which supports querying a status with a `createdAt` sort condition. The base table itself has no sort key. For Scan or Query pagination, copy `LastEvaluatedKey` from the response into `exclusiveStartKey` in the input. The playground runs one request at a time, without automatically consuming additional pages or retrying unprocessed batch items. Filtered scans may return fewer items than their limit.

Parsing, builder validation, and database errors are shown in the output pane. If the service rejects a built command, its SDK input remains available for inspection. The connection indicator checks whether the configured table is available; use its refresh button after starting or seeding the database.

## Configuration

Copy `.env.example` to `.env` to customize the local endpoint or table. The playground automatically loads the repository-root `.env`; restart it after changing these settings. Seed and clear scripts read exported shell variables:

```bash
cp .env.example .env
set -a; source .env; set +a
vp run local:dynamo:seed
```

| Variable                  | Default                 | Purpose                                       |
| ------------------------- | ----------------------- | --------------------------------------------- |
| `DYNAMODB_LOCAL_ENDPOINT` | `http://localhost:8000` | SDK endpoint for scripts and the playground   |
| `DYNAMODB_LOCAL_TABLE`    | `command-builder-test`  | Table used by scripts and playground examples |
| `DYNAMODB_LOCAL_PORT`     | `8000`                  | Host port exposed by Docker Compose           |
| `DYNAMODB_ADMIN_PORT`     | `8001`                  | Host port for the optional DynamoDB Admin UI  |

When changing `DYNAMODB_LOCAL_PORT`, set a matching `DYNAMODB_LOCAL_ENDPOINT`. Port `8001` is already used by DynamoDB Admin by default; choose another free port, such as `8002`.

The playground binds to `127.0.0.1:5173`, uses explicit dummy credentials, requires a loopback DynamoDB endpoint, and limits all commands to the configured table. The AWS SDK and command builders run in a Vite server middleware, with no AWS credentials exposed to the browser. This is a local development app; its static output needs the Vite preview server to execute commands.

## Validation

```bash
vp check
vp test run
vp run playground:typecheck
vp run playground:build
```

With DynamoDB seeded and the playground running, verify every builder against the real local service:

```bash
vp run playground:smoke
```

The smoke check builds and executes both presets for all ten commands. Batch Write’s composite-key reference runs against a uniquely named temporary table with its required schema; the table is deleted afterward. It verifies all ten structured update operations, every structured condition operator, failed-condition behavior, native sets and binary values, then removes its uniquely named temporary writes. It expects the playground at `http://127.0.0.1:5173`; override `PLAYGROUND_URL` to test another local port.

To serve the built UI with the same local API, stop the development server and run:

```bash
vp run playground:preview
```

## Clear, inspect, and stop

Remove all items from the configured test table while retaining its schema:

```bash
vp run local:dynamo:clear
```

DynamoDB Admin is available at <http://localhost:8001>. Stream container logs or stop the services:

```bash
vp run local:dynamo:logs
vp run local:dynamo:stop
```

Data survives stopping containers and `vp run local:dynamo:down`, which removes containers and the network. `docker compose down -v` deletes this Compose project's persistent database volume.

## Troubleshooting

- If the playground reports the database is offline, start Docker and run the start and seed commands, then refresh the connection indicator.
- If port 5173 is occupied, stop the process using it before starting the playground. The strict port setting keeps the UI and smoke check at a predictable URL.
- After editing server-side builder source, restart the playground to load the changes.
- If the seed cannot connect, inspect `vp run local:dynamo:logs` and confirm your endpoint matches the Docker port.
- Run `vp env doctor` when the Vite+ runtime or package-manager setup appears incorrect.
