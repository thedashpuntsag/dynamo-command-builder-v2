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
    resolveDepSubpath: true,
    neverBundle: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
  },
});
