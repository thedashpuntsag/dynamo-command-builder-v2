export const commandIds = [
  'get',
  'put',
  'update',
  'delete',
  'query',
  'scan',
  'batch-get',
  'batch-write',
  'transact-get',
  'transact-write',
] as const;
export type CommandId = (typeof commandIds)[number];
export type CommandExample = {
  id: CommandId;
  name: string;
  group: 'Read' | 'Write' | 'Batch' | 'Transaction';
  description: string;
  builder: string;
  writes: boolean;
  input: Record<string, unknown>;
  allFieldsInput: Record<string, unknown>;
  allFieldsNote: string;
};

export type PlaygroundConfig = { endpoint: string; tableName: string; commands: CommandExample[] };
export type CommandOutcome = {
  ok: boolean;
  phase: string;
  builtInput?: unknown;
  result?: unknown;
  durationMs?: number;
  error?: { name?: string; message: string; issues?: unknown };
};
