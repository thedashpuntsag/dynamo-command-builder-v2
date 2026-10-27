import type { CommandExample, CommandId } from '../shared/commands';

export function getExamples(tableName: string): CommandExample[] {
  const key = { id: 'local-test-001' };
  const item = {
    id: 'playground-item',
    source: 'playground',
    status: 'READY',
    metadata: { date: '2026-10-27T00:00:00.000Z', 'schema.version': '2.0' },
    message: 'Hello from the playground',
    tags: { $set: ['local', 'playground'] },
    payload: { $binary: 'SGVsbG8=' },
    details: { active: true, score: 0, optional: null, history: [{ action: 'CREATED' }] },
  };
  // Repeatable conditions allow both a missing item and an existing playground item.
  const writeCondition = {
    conditionExpression: 'attribute_not_exists(#id) OR begins_with(#id, :prefix)',
    expressionAttributeNames: { '#id': 'id' },
    expressionAttributeValues: { ':prefix': 'playground-' },
    returnValuesOnConditionCheckFailure: 'ALL_OLD',
  };
  const writeMetrics = { returnConsumedCapacity: 'TOTAL', returnItemCollectionMetrics: 'SIZE' };
  const queryInput = {
    tableName,
    partitionKeys: { id: 'local-test-001' },
    sortKeys: {},
    filters: { status: { eq: 'READY' }, createdAt: { gte: 1_798_000_000_000 } },
    filterJoin: 'AND',
    attributes: ['id', 'status', 'metadata', 'order.lines[0]'],
    filterExpression: '#message <> :empty',
    projectionExpression: '#payload, #tags',
    expressionAttributeNames: { '#message': 'message', '#payload': 'payload', '#tags': 'tags' },
    expressionAttributeValues: { ':empty': '' },
    limit: 10,
    consistentRead: true,
    scanIndexForward: true,
    select: 'SPECIFIC_ATTRIBUTES',
    returnConsumedCapacity: 'TOTAL',
  };
  const scanInput = {
    tableName,
    filterExpression: '#status = :status',
    projectionExpression: '#id, #status, #metadata, #order.#lines[0]',
    expressionAttributeNames: {
      '#id': 'id',
      '#status': 'status',
      '#metadata': 'metadata',
      '#order': 'order',
      '#lines': 'lines',
    },
    expressionAttributeValues: { ':status': 'READY' },
    limit: 10,
    consistentRead: true,
    select: 'SPECIFIC_ATTRIBUTES',
    segment: 0,
    totalSegments: 1,
    returnConsumedCapacity: 'TOTAL',
  };
  const updateInput = {
    tableName,
    key: { id: 'playground-item' },
    item: { status: 'UPDATED', message: 'Updated in the playground', details: { active: false, score: 42 } },
    conditionExpression:
      '(attribute_not_exists(#id) OR begins_with(#id, :prefix)) AND (attribute_not_exists(#source) OR #source <> :blockedSource)',
    expressionAttributeNames: { '#id': 'id' },
    expressionAttributeValues: { ':prefix': 'playground-' },
    extraExpAttributeNames: { '#source': 'source' },
    extraExpAttributeValues: { ':blockedSource': 'protected' },
    returnValues: 'ALL_NEW',
    returnValuesOnConditionCheckFailure: 'ALL_OLD',
    ...writeMetrics,
  };
  const batchWriteInput = {
    tables: [
      {
        tableName,
        keySchema: { partitionKey: 'id' },
        operations: [
          { operation: 'PUT', item: { ...item, id: 'playground-batch' } },
          { operation: 'DELETE', key: { id: 'playground-batch-old' } },
        ],
      },
    ],
    ...writeMetrics,
  };
  const transactWriteInput = {
    transactItems: [
      { operation: 'PUT', tableName, item: { ...item, id: 'playground-transaction' }, ...writeCondition },
      {
        operation: 'UPDATE',
        tableName,
        key: { id: 'playground-transaction-update' },
        updateExpression: 'SET #status = :status',
        conditionExpression: writeCondition.conditionExpression,
        expressionAttributeNames: { '#id': 'id', '#status': 'status' },
        expressionAttributeValues: { ':prefix': 'playground-', ':status': 'UPDATED' },
        returnValuesOnConditionCheckFailure: 'ALL_OLD',
      },
      { operation: 'DELETE', tableName, key: { id: 'playground-transaction-old' }, ...writeCondition },
      {
        operation: 'CONDITION_CHECK',
        tableName,
        key,
        conditionExpression: '#status = :ready',
        expressionAttributeNames: { '#status': 'status' },
        expressionAttributeValues: { ':ready': 'READY' },
        returnValuesOnConditionCheckFailure: 'ALL_OLD',
      },
    ],
    ...writeMetrics,
  };
  const definitions: Omit<CommandExample, 'allFieldsInput' | 'allFieldsNote'>[] = [
    {
      id: 'get',
      name: 'Get',
      group: 'Read',
      description: 'Read one seeded item by its primary key.',
      builder: 'buildValidatedGetCommand',
      writes: false,
      input: {
        tableName,
        key,
        attributes: ['id', 'status', 'metadata', 'order.lines[0]'],
        projectionExpression: '#payload, #tags',
        expressionAttributeNames: { '#payload': 'payload', '#tags': 'tags' },
        consistentRead: true,
        returnConsumedCapacity: 'TOTAL',
      },
    },
    {
      id: 'query',
      name: 'Query',
      group: 'Read',
      description: 'Find items using named partition keys and projections.',
      builder: 'buildValidatedQueryCommand',
      writes: false,
      input: queryInput,
    },
    {
      id: 'scan',
      name: 'Scan',
      group: 'Read',
      description: 'Explore the table with filters and pagination.',
      builder: 'buildValidatedScanCommand',
      writes: false,
      input: scanInput,
    },
    {
      id: 'put',
      name: 'Put',
      group: 'Write',
      description: 'Create or replace an item, including sets and binary data.',
      builder: 'buildValidatedPutCommand',
      writes: true,
      input: { tableName, item, ...writeCondition, returnValues: 'ALL_OLD', ...writeMetrics },
    },
    {
      id: 'update',
      name: 'Update',
      group: 'Write',
      description: 'Build an update expression from an object patch.',
      builder: 'buildValidatedUpdateCommand',
      writes: true,
      input: updateInput,
    },
    {
      id: 'delete',
      name: 'Delete',
      group: 'Write',
      description: 'Delete an item and inspect its previous attributes.',
      builder: 'buildValidatedDeleteCommandInput',
      writes: true,
      input: { tableName, key: { id: 'playground-item' }, ...writeCondition, returnValues: 'ALL_OLD', ...writeMetrics },
    },
    {
      id: 'batch-get',
      name: 'Batch Get',
      group: 'Batch',
      description: 'Read multiple seeded items in one request.',
      builder: 'buildValidatedBatchGetCommand',
      writes: false,
      input: {
        tables: [
          {
            tableName,
            keys: [key, { id: 'local-test-002' }],
            attributes: ['id', 'status', 'metadata'],
            consistentRead: true,
          },
        ],
        returnConsumedCapacity: 'TOTAL',
      },
    },
    {
      id: 'batch-write',
      name: 'Batch Write',
      group: 'Batch',
      description: 'Put and delete items in a single batch.',
      builder: 'buildValidatedBatchWriteCommandInput',
      writes: true,
      input: batchWriteInput,
    },
    {
      id: 'transact-get',
      name: 'Transact Get',
      group: 'Transaction',
      description: 'Read a consistent snapshot of multiple items atomically.',
      builder: 'buildValidatedTransactGetCommand',
      writes: false,
      input: {
        transactItems: [key, { id: 'local-test-002' }].map((itemKey) => ({
          tableName,
          key: itemKey,
          projectionExpression: '#id, #status, #metadata',
          expressionAttributeNames: { '#id': 'id', '#status': 'status', '#metadata': 'metadata' },
        })),
        returnConsumedCapacity: 'TOTAL',
      },
    },
    {
      id: 'transact-write',
      name: 'Transact Write',
      group: 'Transaction',
      description: 'Write items and check conditions in an atomic transaction.',
      builder: 'buildValidatedTransactWriteCommand',
      writes: true,
      input: transactWriteInput,
    },
  ];

  // Reference presets cover schema-dependent fields without breaking the seeded presets.
  const { item: _patch, ...updateExpressionInput } = updateInput;
  const allFields: Partial<Record<CommandId, Record<string, unknown>>> = {
    query: {
      ...queryInput,
      indexName: 'status-createdAt-index',
      partitionKeys: { status: 'READY' },
      sortKeys: { createdAt: { between: [1_798_000_000_000, 1_798_003_000_000] } },
      filters: { source: { eq: 'dynamo-command-builder-v2' }, updatedBy: { eq: 'local-seed' } },
      exclusiveStartKey: { id: 'local-test-001', status: 'READY', createdAt: 1_798_000_000_000 },
      consistentRead: false,
    },
    scan: {
      ...scanInput,
      indexName: 'status-createdAt-index',
      exclusiveStartKey: { id: 'local-test-001', status: 'READY', createdAt: 1_798_000_000_000 },
      consistentRead: false,
    },
    update: {
      ...updateExpressionInput,
      updateExpression: 'SET #status = :status, #message = :message',
      expressionAttributeNames: { '#id': 'id', '#status': 'status' },
      expressionAttributeValues: { ':prefix': 'playground-', ':status': 'UPDATED' },
      extraExpAttributeNames: { '#source': 'source', '#message': 'message' },
      extraExpAttributeValues: { ':blockedSource': 'protected', ':message': 'Updated with an explicit expression' },
    },
    'batch-write': {
      ...batchWriteInput,
      tables: [
        {
          tableName,
          keySchema: { partitionKey: 'id', sortKey: 'version' },
          operations: [
            { operation: 'PUT', item: { ...item, id: 'playground-batch', version: 1 } },
            { operation: 'DELETE', key: { id: 'playground-batch-old', version: 1 } },
          ],
        },
      ],
    },
    'transact-write': {
      ...transactWriteInput,
      clientRequestToken: 'playground-transaction-example-001',
    },
  };
  const notes: Partial<Record<CommandId, string>> = {
    get: 'All fields are included. attributes and projectionExpression are merged; keep their paths distinct to avoid overlapping projections.',
    query:
      'All fields are included. This example queries the seeded status-createdAt-index (status partition key, numeric createdAt sort key). Run the seed again to add the index to an existing table. The example starts after local-test-001; replace exclusiveStartKey with a real LastEvaluatedKey when paginating. GSI reads require consistentRead: false, and filters must not target the index keys.',
    scan: 'All fields are included. This example scans the seeded status-createdAt-index. Run the seed again to add it to an existing table. Replace exclusiveStartKey with the previous page’s LastEvaluatedKey. GSI reads require consistentRead: false; segment and totalSegments must be supplied together.',
    update:
      'All expression-mode fields are included. item and updateExpression are mutually exclusive: this preset uses updateExpression; Seeded table demonstrates item. The extraExpAttributeNames and extraExpAttributeValues fields are legacy aliases merged with the main expression maps.',
    'batch-write':
      'All fields are included, including keySchema.sortKey and both PUT and DELETE operations. This reference requires a table whose key is id + version; the seeded table only has id. Use Build only or choose Seeded table to run locally.',
    'transact-write':
      'All fields and all four operation types are included. Use a new clientRequestToken whenever you change the request; reusing a token with a different request can fail for 10 minutes. Transaction operations must target distinct items.',
  };
  return definitions.map((command) => ({
    ...command,
    allFieldsInput: allFields[command.id] ?? command.input,
    allFieldsNote:
      notes[command.id] ??
      'All supported fields are included, including nested operation fields and response options. This example can run against the seeded local table.',
  }));
}
