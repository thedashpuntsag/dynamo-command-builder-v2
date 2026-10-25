# Testing with DynamoDB Local

This repository includes an in-memory [DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html) service for integration testing. It is isolated from AWS and does not require an AWS account or real credentials.

## Prerequisites

- The development requirements listed in the [README](../README.md#requirements)
- Docker with the Compose plugin (`docker compose version`)

## Start and verify the service

Install dependencies, start DynamoDB Local, then run the idempotent seed and smoke test:

```bash
vp install
vp run local:dynamo:start
vp run local:dynamo:seed
```

The seed script waits for the service, creates a `command-builder-test` table if necessary, and writes and reads 50 deterministic items using command inputs built by this package. Each item includes `createdAt` and `updatedAt` as numeric 13-digit Unix timestamps in milliseconds, along with `createdBy` and `updatedBy` fields. A successful run prints the endpoint, table name, and verified item count.

DynamoDB Local listens at `http://localhost:8000`. Its data is in memory and is discarded when the container stops.

## Connect a test client

Always set a local endpoint and explicit dummy credentials. This prevents the SDK from looking up real credentials and makes it clear that tests must not contact AWS:

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    endpoint: process.env.DYNAMODB_LOCAL_ENDPOINT ?? 'http://localhost:8000',
    region: 'local',
    credentials: {
      accessKeyId: 'local',
      secretAccessKey: 'local',
    },
  })
);
```

The seed script recognizes these optional environment variables:

| Variable                  | Default                 | Purpose                                       |
| ------------------------- | ----------------------- | --------------------------------------------- |
| `DYNAMODB_LOCAL_ENDPOINT` | `http://localhost:8000` | SDK endpoint used by the seed script          |
| `DYNAMODB_LOCAL_PORT`     | `8000`                  | Host port exposed by Docker Compose           |
| `DYNAMODB_LOCAL_TABLE`    | `command-builder-test`  | Table created and verified by the seed script |

When changing `DYNAMODB_LOCAL_PORT`, also set the matching endpoint:

```bash
DYNAMODB_LOCAL_PORT=8001 vp run local:dynamo:start
DYNAMODB_LOCAL_ENDPOINT=http://localhost:8001 vp run local:dynamo:seed
```

## Inspect and stop

Stream the service logs:

```bash
vp run local:dynamo:logs
```

Stop and remove the container and network:

```bash
vp run local:dynamo:stop
```

## Troubleshooting

- If port 8000 is occupied, use the alternate-port example above.
- If the seed cannot connect, inspect `vp run local:dynamo:logs` and confirm Docker is running.
- If Docker reports an architecture warning, update Docker Desktop; the published DynamoDB Local image supports common development platforms.
- Run `vp env doctor` when the Vite+ runtime or package-manager setup appears incorrect.
