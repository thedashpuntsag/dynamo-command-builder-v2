import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Rolldown } from 'vite-plus/pack';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const virtual = '\0package-size-consumer';
const scenarios = [
  ['root-get', 'index.mjs', 'export { buildValidatedGetCommand }'],
  ['root-update', 'index.mjs', 'export { buildValidatedUpdateCommand }'],
  ['all-exports', 'index.mjs', 'export *'],
];
const files = await readdir(dist);
if (files.includes('get.mjs')) scenarios.push(['subpath-get', 'get.mjs', 'export *']);
if (files.includes('update.mjs')) scenarios.push(['subpath-update', 'update.mjs', 'export *']);
const consumers = [];
for (const [name, entry, exports] of scenarios) {
  for (const includeZod of [false, true]) {
    const bundle = await Rolldown.rolldown({
      input: virtual,
      external: (id) =>
        id.startsWith('node:') ||
        id.startsWith('@aws-sdk/') ||
        (!includeZod && (id === 'zod' || id.startsWith('zod/'))),
      plugins: [
        {
          name: 'size-consumer',
          resolveId: (id) => (id === virtual ? virtual : null),
          load: (id) => (id === virtual ? `${exports} from ${JSON.stringify(path.join(dist, entry))};` : null),
        },
      ],
      treeshake: true,
    });
    try {
      const result = await bundle.generate({ format: 'esm', minify: true });
      const chunks = result.output.filter((item) => item.type === 'chunk');
      consumers.push({
        name,
        dependencies: includeZod ? 'with-zod' : 'external',
        bytes: chunks.reduce((sum, item) => sum + Buffer.byteLength(item.code), 0),
        gzip: chunks.reduce((sum, item) => sum + gzipSync(item.code).length, 0),
      });
    } finally {
      await bundle.close();
    }
  }
}
const artifacts = await Promise.all(
  files.map(async (file) => {
    const data = await readFile(path.join(dist, file));
    return { file, bytes: data.length, gzip: gzipSync(data).length };
  })
);
const report = { artifacts, totalBytes: artifacts.reduce((sum, item) => sum + item.bytes, 0), consumers };
const save = process.argv.indexOf('--save');
if (save !== -1) await writeFile(process.argv[save + 1], `${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes('--check')) {
  const baseline = JSON.parse(await readFile(path.join(root, 'test/package/bundle-baseline.json'), 'utf8'));
  for (const name of ['root-get', 'root-update']) {
    for (const dependencies of ['external', 'with-zod']) {
      const before = baseline.consumers.find((item) => item.name === name && item.dependencies === dependencies);
      const after = consumers.find((item) => item.name === name && item.dependencies === dependencies);
      const limit = dependencies === 'external' ? 0.6 : 0.85;
      assert(after.bytes <= before.bytes * limit, `${name} (${dependencies}) exceeds the bundle budget`);
    }
  }
  console.log('Consumer bundle budgets passed against the pre-optimization baseline.');
}
console.table(consumers);
console.log(
  `Published dist contents: ${report.totalBytes} bytes (${artifacts.length} files). AWS SDK and Node built-ins remain external in all scenarios.`
);
