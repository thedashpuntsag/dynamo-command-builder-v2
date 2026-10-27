import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchGetCommand,
  BatchWriteCommand,
  TransactGetCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import * as builders from '@/command';
import type { CommandId } from '../shared/commands';

// Each public builder validates its own unknown input before producing SDK input.
function adapt<I, O, C>(builder: (input: I) => O, Command: new (input: O) => C) {
  return (input: unknown): C => new Command(builder(input as I));
}
const commands = {
  get: adapt(builders.buildValidatedGetCommand, GetCommand),
  put: adapt(builders.buildValidatedPutCommand, PutCommand),
  update: adapt(builders.buildValidatedUpdateCommand, UpdateCommand),
  delete: adapt(builders.buildValidatedDeleteCommandInput, DeleteCommand),
  query: adapt(builders.buildValidatedQueryCommand, QueryCommand),
  scan: adapt(builders.buildValidatedScanCommand, ScanCommand),
  'batch-get': adapt(builders.buildValidatedBatchGetCommand, BatchGetCommand),
  'batch-write': adapt(builders.buildValidatedBatchWriteCommandInput, BatchWriteCommand),
  'transact-get': adapt(builders.buildValidatedTransactGetCommand, TransactGetCommand),
  'transact-write': adapt(builders.buildValidatedTransactWriteCommand, TransactWriteCommand),
};

export function buildCommand(id: CommandId, input: unknown, tableName: string) {
  const command = commands[id](input);
  const built = command.input;
  const tables: string[] = [];
  if ('TableName' in built && built.TableName) tables.push(built.TableName);
  if ('RequestItems' in built && built.RequestItems) tables.push(...Object.keys(built.RequestItems));
  if ('TransactItems' in built && built.TransactItems) {
    for (const item of built.TransactItems) {
      for (const operation of Object.values(item)) {
        if (operation?.TableName) tables.push(operation.TableName);
      }
    }
  }
  if (tables.length === 0 || tables.some((table) => table !== tableName)) {
    throw new Error(`This playground only runs commands against the configured local table "${tableName}".`);
  }
  return command;
}

export async function executeCommand(
  client: import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient,
  command: ReturnType<typeof buildCommand>
): Promise<unknown> {
  // Narrow the SDK's command union so each middleware stack retains its input/output types.
  if (command instanceof GetCommand) return client.send(command);
  if (command instanceof PutCommand) return client.send(command);
  if (command instanceof UpdateCommand) return client.send(command);
  if (command instanceof DeleteCommand) return client.send(command);
  if (command instanceof QueryCommand) return client.send(command);
  if (command instanceof ScanCommand) return client.send(command);
  if (command instanceof BatchGetCommand) return client.send(command);
  if (command instanceof BatchWriteCommand) return client.send(command);
  if (command instanceof TransactGetCommand) return client.send(command);
  return client.send(command);
}
