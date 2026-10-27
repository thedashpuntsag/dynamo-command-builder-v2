import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite-plus';
import { createJiti } from 'jiti';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(async ({ mode }) => {
  // Config dependencies run before Vite's resolver; use the source alias here too.
  const { createApi } = await createJiti(import.meta.url, {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  }).import<typeof import('./src/server/api')>('./src/server/api.ts');
  const env = { ...loadEnv(mode, repo, 'DYNAMODB_LOCAL_'), ...process.env };
  const endpoint = env.DYNAMODB_LOCAL_ENDPOINT ?? 'http://localhost:8000';
  const tableName = env.DYNAMODB_LOCAL_TABLE ?? 'command-builder-test';
  const api: Plugin = {
    name: 'local-dynamodb-playground',
    configureServer(server) {
      const handler = createApi(endpoint, tableName);
      server.middlewares.use((req, res, next) => {
        void handler.handle(req, res, next);
      });
      server.httpServer?.once('close', handler.close);
    },
    configurePreviewServer(server) {
      const handler = createApi(endpoint, tableName);
      server.middlewares.use((req, res, next) => {
        void handler.handle(req, res, next);
      });
      server.httpServer.once('close', handler.close);
    },
  };
  return {
    root,
    envDir: repo,
    plugins: [api],
    resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { outDir: 'dist', emptyOutDir: true },
    esbuild: { jsx: 'automatic' },
  };
});
