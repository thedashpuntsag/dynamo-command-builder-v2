# DynamoDB command playground

A local React application for building and executing library commands against DynamoDB Local. Run commands from the repository root; dependencies and package scripts are managed by the root project.

```bash
vp run local:dynamo:start
vp run local:dynamo:seed
vp run local:playground
```

Open <http://127.0.0.1:5173>. See the [local testing guide](../../docs/local-test.md) for input syntax, example presets, configuration, and database cleanup.

The seed creates 50 example items and `status-createdAt-index`, a global secondary index with a string `status` partition key, numeric `createdAt` sort key, and `ALL` projection. Re-run the seed to add the index to an existing table. The Query and Scan **All fields** presets use this index with `consistentRead: false`; select a preset to refresh an older saved draft.

## Project layout

```text
playground/
├── index.html                 # Vite HTML entry
├── vite.config.ts             # Dev/preview server and local API integration
├── tsconfig.json              # Playground type checking
├── src/
│   ├── main.tsx               # React entry point
│   ├── App.tsx                # Application shell and page selection
│   ├── styles.css             # Application styles and responsive layouts
│   ├── components/
│   │   └── Editor.tsx         # CodeMirror input editor
│   ├── hooks/
│   │   └── useRoute.ts        # Hash-based navigation
│   ├── lib/
│   │   └── commands.ts        # Command icons and navigation groups
│   ├── pages/
│   │   ├── WelcomePage.tsx    # Command collection
│   │   └── CommandPage.tsx    # Input presets, execution, and results
│   ├── shared/
│   │   └── commands.ts        # Command identifiers and API/UI types
│   └── server/
│       ├── api.ts            # Local HTTP API and DynamoDB client lifecycle
│       ├── codec.ts          # JSON5 parsing and native DynamoDB type tags
│       ├── examples.ts       # Seeded-table and all-fields input presets
│       └── execute.ts        # Public builder dispatch and SDK execution
├── tests/
│   ├── api.test.ts           # API validation and execution behavior
│   ├── codec.test.ts         # Native type encoding and parsing
│   └── commands.test.ts      # Example validation and schema field coverage
└── scripts/
    └── smoke.ts              # Integration check against a running playground
```

Keep browser components and pages separate from `server/`. Only shared types and command metadata cross that boundary; AWS clients and library execution stay on the server. The `@/` alias refers to the repository's library source, not this application's `src` folder.

## Validate

```bash
vp check
vp test run
vp run local:playground:typecheck
vp run local:playground:build
```

With the playground and seeded database running:

```bash
vp run local:playground:smoke
```

To serve the built application with its local API:

```bash
vp run local:playground:preview
```

Restart the playground after changing server-side source. Both development and preview load the repository-root `.env` and enforce the configured local table.
