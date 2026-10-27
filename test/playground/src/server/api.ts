import type { IncomingMessage, ServerResponse } from 'node:http';
import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { commandIds, type CommandId } from '../shared/commands';
import { getExamples } from './examples';
import { parseInput, stringify } from './codec';
import { buildCommand, executeCommand } from './execute';

export function createApi(endpoint: string, tableName: string) {
  const url = new URL(endpoint);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('The playground requires a loopback DYNAMODB_LOCAL_ENDPOINT.');
  }
  const client = new DynamoDBClient({
    endpoint,
    region: 'local',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
  });
  const documentClient = DynamoDBDocumentClient.from(client);

  function respond(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(stringify(body));
  }

  return {
    close: () => client.destroy(),
    async handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
      const path = req.url?.split('?')[0];
      if (!path?.startsWith('/api/playground/')) return next();
      // Only requests from this local UI may execute operations.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
        respond(res, 403, { error: { message: 'Cross-origin requests are not allowed.' } });
        return;
      }
      let phase = 'parse';
      let builtInput: unknown;
      const start = performance.now();
      try {
        if (path === '/api/playground/config' && req.method === 'GET') {
          respond(res, 200, { endpoint, tableName, commands: getExamples(tableName) });
          return;
        }
        if (path === '/api/playground/health' && req.method === 'GET') {
          phase = 'connect';
          const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
          respond(res, 200, { status: Table?.TableStatus, itemCount: Table?.ItemCount });
          return;
        }
        if (path !== '/api/playground/execute' || req.method !== 'POST') {
          respond(res, 404, { error: { message: 'Unknown playground route.' } });
          return;
        }
        if (!req.headers['content-type']?.startsWith('application/json')) {
          respond(res, 415, { error: { message: 'Expected application/json.' } });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          if (size > 1_000_000) throw new Error('Input exceeds the 1 MB playground limit.');
          chunks.push(bytes);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
        if (
          !commandIds.includes(body.command as CommandId) ||
          typeof body.source !== 'string' ||
          !['build', 'run'].includes(String(body.action))
        ) {
          throw new Error('Expected a known command, source string, and build/run action.');
        }
        const input = parseInput(body.source);
        phase = 'build';
        const command = buildCommand(body.command as CommandId, input, tableName);
        builtInput = command.input;
        let result: unknown;
        if (body.action === 'run') {
          phase = 'execute';
          result = await executeCommand(documentClient, command);
        }
        respond(res, 200, {
          ok: true,
          phase: body.action === 'build' ? 'built' : 'executed',
          builtInput,
          result,
          durationMs: Math.round(performance.now() - start),
        });
      } catch (error: unknown) {
        const details = error instanceof Error ? error : new Error(String(error));
        respond(res, phase === 'execute' || phase === 'connect' ? 502 : 400, {
          ok: false,
          phase,
          builtInput,
          durationMs: Math.round(performance.now() - start),
          error: {
            name: details.name,
            message: details.message,
            ...('issues' in details ? { issues: details.issues } : {}),
          },
        });
      }
    },
  };
}
