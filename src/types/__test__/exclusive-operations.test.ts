import { describe, expect, it } from 'vite-plus/test';
import ts from 'typescript';
import path from 'node:path';

describe('exclusive operation types', () => {
  it('checks negative assignments with the TypeScript compiler', () => {
    const filename = path.resolve('src/types/__exclusive_type_probe__.ts');
    const fixture = `
import type { Condition, ConditionOperation, ConditionRecord, UpdateOperation } from './index';
export const validCondition: Condition = { and: [{ attr: 'status', eq: 'PENDING' }, { attr: 'version', gte: 1 }] };
export const validUpdate: UpdateOperation = { attr: 'status', set: { eq: 1, gte: 2 } };
// @ts-expect-error Comparisons are mutually exclusive.
export const condition: Condition = { attr: 'status', eq: 'PENDING', gte: 'A' };
// @ts-expect-error Updates are mutually exclusive.
export const update: UpdateOperation = { attr: 'status', set: 'PENDING', remove: true };
// @ts-expect-error Logical groups cannot also be attribute leaves.
export const mixedGroup: Condition = { attr: 'status', eq: 'PENDING', and: [{ attr: 'id', exists: true }, { attr: 'version', gte: 1 }] };
// @ts-expect-error Group nodes cannot contain comparison operators.
export const comparisonGroup: Condition = { and: [{ attr: 'id', exists: true }, { attr: 'version', gte: 1 }], eq: 1 };
// @ts-expect-error Logical groups are mutually exclusive.
export const twoGroups: Condition = { and: [{ attr: 'id', exists: true }, { attr: 'version', gte: 1 }], not: { attr: 'id', exists: true } };
// @ts-expect-error Size comparisons are mutually exclusive.
export const size: ConditionOperation = { size: { eq: 1, gte: 2 } };
// @ts-expect-error Record operator objects are mutually exclusive.
export const record: ConditionRecord = { status: { eq: 'PENDING', beginsWith: 'P' } };
`;
    const config = ts.readConfigFile('tsconfig.json', (filename) => ts.sys.readFile(filename));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
    const host = ts.createCompilerHost(parsed.options);
    const originalGetSource = host.getSourceFile.bind(host);
    host.getSourceFile = (name, ...args) =>
      name === filename
        ? ts.createSourceFile(name, fixture, ts.ScriptTarget.Latest, true)
        : originalGetSource(name, ...args);
    const program = ts.createProgram([filename], { ...parsed.options, noEmit: true }, host);
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    expect(diagnostics).toEqual([]);
  });
});
