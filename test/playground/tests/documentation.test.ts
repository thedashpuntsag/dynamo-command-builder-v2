import { describe, expect, it } from 'vite-plus/test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { compileFunction } from 'node:vm';
import ts from 'typescript';
import JSON5 from 'json5';
import * as builders from '@/command';
import * as utilities from '@/utils';
import * as schemas from '@/types';
import * as conditionCompiler from '@/utils/condition-expression';
import * as updateCompiler from '@/utils/update-expression';
import * as numbers from '@/utils/dynamo-number';
import * as lowLevel from '@aws-sdk/client-dynamodb';
import * as document from '@aws-sdk/lib-dynamodb';
import { parseInput } from '../src/server/codec';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  name: string;
  scripts: Record<string, string>;
};
const markdownFiles = [
  'README.md',
  ...fs
    .readdirSync(path.join(root, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`),
  'test/playground/README.md',
];
const markdown = markdownFiles.map((filename) => ({
  filename,
  source: fs.readFileSync(path.join(root, filename), 'utf8'),
}));
const markdownBlocks = markdown.flatMap(({ filename, source }) =>
  [...source.matchAll(/```(ts|typescript|js|javascript|json5)\n([\s\S]*?)```/g)].map((match, index) => ({
    filename,
    index,
    language: match[1]!,
    source: match[2]!,
    prefix: source.slice(0, match.index),
  }))
);
const sourceBlocks = ['src/command', 'src/utils'].flatMap((directory) =>
  fs
    .readdirSync(directory)
    .filter((name) => name.endsWith('.ts'))
    .flatMap((name) => {
      const filename = `${directory}/${name}`;
      const text = fs.readFileSync(filename, 'utf8');
      const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
      return ast.statements.flatMap((node) => {
        if (
          (!ts.isFunctionDeclaration(node) && !ts.isVariableStatement(node)) ||
          !node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
        )
          return [];
        return ts.getJSDocCommentsAndTags(node).flatMap((comment) => {
          const source = comment.getText(ast).replace(/^\s*\* ?/gm, '');
          return [...source.matchAll(/```(ts|typescript)\n([\s\S]*?)```/g)].map((match, index) => ({
            filename,
            index,
            language: match[1]!,
            source: match[2]!,
            prefix: '',
          }));
        });
      });
    })
);
const blocks = [...markdownBlocks, ...sourceBlocks];
const exported = { ...builders, ...utilities, ...schemas, ...conditionCompiler, ...updateCompiler, ...numbers };
const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('@aws-sdk/lib-dynamodb'));
const utilityPackage = sdkRequire.resolve('@aws-sdk/util-dynamodb/package.json');
const utilityManifest = JSON.parse(fs.readFileSync(utilityPackage, 'utf8')) as { types: string };
const config = ts.readConfigFile('tsconfig.json', (filename) => ts.sys.readFile(filename));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);

function prepare(source: string): string {
  const ast = ts.createSourceFile('snippet.ts', source, ts.ScriptTarget.Latest, true);
  const bound = new Set<string>();
  const used = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) used.add(node.text);
    if (
      (ts.isImportSpecifier(node) ||
        ts.isImportClause(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    )
      bound.add(node.name.text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const imports = Object.keys(exported).filter((name) => used.has(name) && !bound.has(name));
  const declarations = [
    ['client', "import('@aws-sdk/client-dynamodb').DynamoDBClient"],
    ['docClient', "import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient"],
  ]
    .filter(([name]) => used.has(name!) && !bound.has(name!))
    .map(([name, type]) => `declare const ${name}: ${type};`)
    .join('\n');
  const modules = new Map<string, string[]>();
  for (const name of imports) {
    const module =
      name in conditionCompiler
        ? '@/utils/condition-expression'
        : name in updateCompiler
          ? '@/utils/update-expression'
          : name in numbers
            ? '@/utils/dynamo-number'
            : manifest.name;
    modules.set(module, [...(modules.get(module) ?? []), name]);
  }
  const header = [...modules].map(([module, names]) => `import { ${names.join(', ')} } from '${module}';`).join('\n');
  return `${header}\n${declarations}\n${source}\nexport {};`;
}

const codeBlocks = blocks.filter(
  (block) => block.language !== 'json5' && !['README.md', 'docs/local-test.md'].includes(block.filename)
);
const virtual = new Map<string, string>();
for (const block of codeBlocks) {
  const filename = block.source.startsWith('// client/dynamodb-client.ts')
    ? 'client/dynamodb-client.ts'
    : block.source.startsWith('// client/document-client.ts')
      ? 'client/document-client.ts'
      : `${block.filename.replaceAll('/', '_')}-${block.index}.mts`;
  virtual.set(path.join(root, '__documentation__', filename), prepare(block.source));
}

describe('documentation examples', () => {
  it('uses package scripts that exist', () => {
    for (const { filename, source } of markdown)
      for (const match of source.matchAll(/\bvp run ([\w:-]+)/g))
        expect(manifest.scripts, `${filename}: ${match[0]}`).toHaveProperty(match[1]!);
  });
  it('type-checks every TypeScript documentation block with its documented client context', () => {
    const options = {
      ...parsed.options,
      noEmit: true,
      noUnusedLocals: false,
      noUnusedParameters: false,
      rootDir: root,
      target: ts.ScriptTarget.ES2022,
      paths: {
        ...parsed.options.paths,
        [manifest.name]: [path.join(root, 'src/index.ts')],
        '@aws-sdk/util-dynamodb': [path.resolve(path.dirname(utilityPackage), utilityManifest.types)],
      },
    };
    const host = ts.createCompilerHost(options);
    const originalGet = host.getSourceFile.bind(host);
    const originalExists = host.fileExists.bind(host);
    const originalRead = host.readFile.bind(host);
    const originalDirectoryExists = host.directoryExists?.bind(host);
    host.directoryExists = (directory) =>
      [...virtual.keys()].some((filename) => filename.startsWith(directory + path.sep)) ||
      originalDirectoryExists?.(directory) === true;
    host.fileExists = (filename) => virtual.has(filename) || originalExists(filename);
    host.readFile = (filename) => virtual.get(filename) ?? originalRead(filename);
    host.getSourceFile = (filename, ...args) =>
      virtual.has(filename)
        ? ts.createSourceFile(filename, virtual.get(filename)!, options.target, true)
        : originalGet(filename, ...args);
    const program = ts.createProgram([...virtual.keys()], options, host);
    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file && virtual.has(diagnostic.file.fileName))
      .map(
        (diagnostic) =>
          `${path.basename(diagnostic.file!.fileName)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
      );
    expect(errors).toEqual([]);
  });
  it.each(
    blocks.filter(
      (block) =>
        block.language === 'json5' ||
        (['README.md', 'docs/local-test.md'].includes(block.filename) && block.language === 'js')
    )
  )('parses the data fragment $filename #$index', (block) => {
    const value = JSON5.parse(block.source) as Record<string, unknown>;
    if (block.filename === 'docs/query-command.md' && ('attributes' in value || 'filters' in value)) {
      const build = () =>
        builders.buildValidatedQueryCommand({
          tableName: 'Orders',
          partitionKeys: { customerId: 'customer-1' },
          ...value,
        });
      const expectedInvalid = /Invalid paths:\s*$|Other selection modes conflict with a projection:\s*$/.test(
        block.prefix
      );
      if (expectedInvalid || block.source.includes('// Invalid')) expect(build).toThrow();
      else expect(build).not.toThrow();
    }
    if (block.filename === 'docs/local-test.md')
      expect(() =>
        builders.buildValidatedPutCommand(parseInput(block.source) as schemas.CustomPutCmdInput)
      ).not.toThrow();
  });

  it.each(codeBlocks.filter((block) => /buildValidated\w+\(/.test(block.source) || block.filename.startsWith('src/')))(
    'builds the library snippets in $filename #$index without network calls',
    async (block) => {
      // Imports resolve to the repository source; send is stubbed so docs never contact AWS.
      const fakeClient = { send: async () => ({ Item: {}, Items: [], Attributes: {} }) };
      const load = (name: string): unknown => {
        if (name === manifest.name) return exported;
        if (name === '@aws-sdk/client-dynamodb')
          return {
            ...lowLevel,
            DynamoDBClient: class {
              send = fakeClient.send;
            },
          };
        if (name === '@aws-sdk/lib-dynamodb')
          return { ...document, DynamoDBDocumentClient: { from: () => fakeClient } };
        throw new Error(`Unexpected snippet import: ${name}`);
      };
      const compiled = ts.transpileModule(block.source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText;
      const names = Object.keys(exported);
      const execute = compileFunction(`return (async () => { ${compiled} })();`, ['require', 'exports', ...names]) as (
        ...args: unknown[]
      ) => Promise<void>;
      await execute(load, {}, ...Object.values(exported));
    }
  );

  it('validates all documented update operation fragments', () => {
    const source = fs.readFileSync('docs/update-command.md', 'utf8');
    const fragments = [...source.matchAll(/`(\{ attr: '[^`]+\})`/g)];
    expect(fragments.length).toBeGreaterThanOrEqual(10);
    for (const [, fragment] of fragments) {
      const operation = compileFunction(`return (${fragment});`)() as schemas.UpdateOperation;
      expect(() =>
        builders.buildValidatedUpdateCommand({ tableName: 'Orders', key: { id: '1' }, updates: [operation] })
      ).not.toThrow();
    }
  });
  it('validates all documented condition operator fragments', () => {
    const source = fs.readFileSync('docs/put-command.md', 'utf8');
    for (const [, fragment] of source.matchAll(/`(\{ attr: '[^`]+\})`/g)) {
      const condition = compileFunction(`return (${fragment});`)() as schemas.Condition;
      expect(() =>
        builders.buildValidatedPutCommand({ tableName: 'Orders', item: { id: '1' }, condition })
      ).not.toThrow();
    }
  });
});
