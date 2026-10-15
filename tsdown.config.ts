import { defineConfig } from 'vite-plus/pack';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  outDir: 'dist',
  target: 'es2020',
  deps: {
    // tsdown <0.23 compatibility: resolve external dependency subpaths.
    // Remove to preserve subpath imports as written (the new default).
    // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
    resolveDepSubpath: true,
    neverBundle: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
  },
});
