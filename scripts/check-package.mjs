import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const require = createRequire(import.meta.url);
const esm = await import(manifest.name);
const cjs = require(manifest.name);
const previous = JSON.parse(await readFile(path.join(root, 'test/package/root-exports.json'), 'utf8'));
assert.deepEqual(Object.keys(esm).sort(), previous, 'ESM root exports changed');
assert.deepEqual(Object.keys(cjs).sort(), previous, 'CommonJS root exports changed');

/** @type {Record<string, [string, Record<string, unknown>]>} */
const examples = {
  get: ['buildValidatedGetCommand', { tableName: 'Orders', key: { id: '1' } }],
  put: [
    'buildValidatedPutCommand',
    { tableName: 'Orders', item: { id: '1' }, condition: { attr: 'id', notExists: true } },
  ],
  update: [
    'buildValidatedUpdateCommand',
    {
      tableName: 'Orders',
      key: { id: '1' },
      updates: [{ attr: 'status', set: 'READY' }],
      condition: { attr: 'version', eq: 1 },
    },
  ],
  delete: ['buildValidatedDeleteCommandInput', { tableName: 'Orders', key: { id: '1' } }],
  query: ['buildValidatedQueryCommand', { tableName: 'Orders', partitionKeys: { id: '1' } }],
  scan: ['buildValidatedScanCommand', { tableName: 'Orders' }],
  'batch-get': ['buildValidatedBatchGetCommand', { tables: [{ tableName: 'Orders', keys: [{ id: '1' }] }] }],
  'batch-write': [
    'buildValidatedBatchWriteCommandInput',
    {
      tables: [
        {
          tableName: 'Orders',
          keySchema: { partitionKey: 'id' },
          operations: [{ operation: 'DELETE', key: { id: '1' } }],
        },
      ],
    },
  ],
  'transact-get': ['buildValidatedTransactGetCommand', { transactItems: [{ tableName: 'Orders', key: { id: '1' } }] }],
  'transact-write': [
    'buildValidatedTransactWriteCommand',
    { transactItems: [{ operation: 'PUT', tableName: 'Orders', item: { id: '1' } }] },
  ],
};
for (const [subpath, [builder, input]] of Object.entries(examples)) {
  const imported = await import(`${manifest.name}/${subpath}`);
  const required = require(`${manifest.name}/${subpath}`);
  assert.equal(imported[builder], esm[builder], `${subpath} ESM builder duplicated`);
  assert.equal(required[builder], cjs[builder], `${subpath} CommonJS builder duplicated`);
  assert.deepEqual(imported[builder](input), required[builder](input), `${subpath} format behavior differs`);
}
for (const subpath of ['http', 'legacy']) {
  const imported = await import(`${manifest.name}/${subpath}`);
  const required = require(`${manifest.name}/${subpath}`);
  assert.deepEqual(Object.keys(imported).sort(), Object.keys(required).sort());
}
for (const entry of Object.values(manifest.exports)) {
  for (const condition of ['import', 'require']) {
    await access(path.join(root, entry[condition].default));
    await access(path.join(root, entry[condition].types));
  }
}

// Compile virtual NodeNext consumers in both formats without adding source fixtures to dist.
for (const extension of ['mts', 'cts']) {
  const filename = path.join(root, `test/package/consumer.${extension}`);
  const fixture =
    Object.entries(examples)
      .map(
        ([subpath, [builder]], index) =>
          `import { ${builder} as builder${index} } from '${manifest.name}/${subpath}';\nvoid builder${index};`
      )
      .join('\n') +
    `
import type { Condition, UpdateOperation, CustomUpdateCmdInput } from '${manifest.name}/update';
import * as rootPackage from '${manifest.name}';
import * as http from '${manifest.name}/http';
import * as legacy from '${manifest.name}/legacy';
void rootPackage; void http; void legacy;
export const condition: Condition = { attr: 'version', eq: 1 };
export const operation: UpdateOperation = { attr: 'status', set: 'READY' };
export const input: CustomUpdateCmdInput = { tableName: 'Orders', key: { id: '1' }, updates: [operation], condition };
`;
  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    exactOptionalPropertyTypes: true,
    skipLibCheck: false,
    noEmit: true,
    types: ['node'],
  };
  const host = ts.createCompilerHost(options);
  const getSource = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...args) =>
    name === filename ? ts.createSourceFile(name, fixture, options.target, true) : getSource(name, ...args);
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n'));
  assert.deepEqual(diagnostics, [], `${extension} consumer type resolution failed`);
}
console.log(
  `Package checks passed: ${previous.length} root exports preserved, all ${Object.keys(manifest.exports).length} entry points resolve in ESM/CommonJS, and both declaration formats compile.`
);
