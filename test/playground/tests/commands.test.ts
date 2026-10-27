import { describe, expect, it } from 'vite-plus/test';
import { parseInput, stringify } from '../src/server/codec';
import { getExamples } from '../src/server/examples';
import { buildCommand } from '../src/server/execute';
import {
  customGetCmdInputSch,
  customPutCmdInputSch,
  customUpdateCmdInputSch,
  customDeleteCmdInputSch,
  customQueryCmdInputSch,
  customScanCmdInputSch,
  customBatchGetCmdInputSch,
  customBatchWriteCmdInputSch,
  customTransactGetCmdInputSch,
  customTransactWriteCmdInputSch,
  customTransactWriteItemSch,
} from '@/types/command-input.types';

const tableName = 'command-builder-test';
const examples = getExamples(tableName);

describe('playground builder dispatch', () => {
  it.each(examples)('builds the $name example using the public builder', (example) => {
    const command = buildCommand(example.id, parseInput(stringify(example.input)), tableName);
    expect(command.constructor.name).toBe(`${example.name.replaceAll(' ', '')}Command`);
    expect(command.input).toBeDefined();
  });
  it.each(examples)('builds the $name all-fields reference using the public builder', (example) => {
    expect(() => buildCommand(example.id, parseInput(stringify(example.allFieldsInput)), tableName)).not.toThrow();
  });
  it.each(['get', 'batch-get', 'transact-write'] as const)('rejects other tables in %s commands', (id) => {
    const example = examples.find((entry) => entry.id === id)!;
    const input = parseInput(stringify(example.input).replaceAll(tableName, 'another-table'));
    expect(() => buildCommand(id, input, tableName)).toThrow('configured local table');
  });
});

describe('example field coverage', () => {
  const schemas = {
    get: customGetCmdInputSch,
    put: customPutCmdInputSch,
    update: customUpdateCmdInputSch,
    delete: customDeleteCmdInputSch,
    query: customQueryCmdInputSch,
    scan: customScanCmdInputSch,
    'batch-get': customBatchGetCmdInputSch,
    'batch-write': customBatchWriteCmdInputSch,
    'transact-get': customTransactGetCmdInputSch,
    'transact-write': customTransactWriteCmdInputSch,
  };
  it.each(examples)('documents every $name input field across its compatible presets', (example) => {
    const documented = new Set([...Object.keys(example.input), ...Object.keys(example.allFieldsInput)]);
    expect(documented).toEqual(new Set(Object.keys(schemas[example.id].shape)));
  });
  it('documents every nested batch field, including composite keys and both write operation types', () => {
    const get = customBatchGetCmdInputSch.parse(examples.find((example) => example.id === 'batch-get')!.allFieldsInput);
    expect(Object.keys(get.tables[0]!)).toEqual(Object.keys(customBatchGetCmdInputSch.shape.tables.element.shape));
    const write = customBatchWriteCmdInputSch.parse(
      parseInput(stringify(examples.find((example) => example.id === 'batch-write')!.allFieldsInput))
    );
    const table = write.tables[0]!;
    expect(new Set(Object.keys(table))).toEqual(
      new Set(Object.keys(customBatchWriteCmdInputSch.shape.tables.element.shape))
    );
    expect(Object.keys(table.keySchema)).toEqual(['partitionKey', 'sortKey']);
    expect(table.operations.map((operation) => operation.operation)).toEqual(['PUT', 'DELETE']);
  });
  it('documents every nested transaction field and every write operation', () => {
    const get = customTransactGetCmdInputSch.parse(
      examples.find((example) => example.id === 'transact-get')!.allFieldsInput
    );
    expect(Object.keys(get.transactItems[0]!)).toEqual(
      Object.keys(customTransactGetCmdInputSch.shape.transactItems.element.shape)
    );
    const write = customTransactWriteCmdInputSch.parse(
      parseInput(stringify(examples.find((example) => example.id === 'transact-write')!.allFieldsInput))
    );
    for (const option of customTransactWriteItemSch.options) {
      const operation = write.transactItems.find((entry) => entry.operation === option.shape.operation.value);
      expect(operation).toBeDefined();
      expect(new Set(Object.keys(operation!))).toEqual(new Set(Object.keys(option.shape)));
    }
  });
});
