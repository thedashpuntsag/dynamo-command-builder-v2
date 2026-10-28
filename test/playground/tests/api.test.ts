import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createApi } from '../src/server/api';
import { stringify } from '../src/server/codec';
import { getExamples } from '../src/server/examples';

const tableName = 'command-builder-test';
const examples = getExamples(tableName);
afterEach(() => vi.restoreAllMocks());

async function request(body: unknown, origin?: string) {
  const api = createApi('http://localhost:8000', tableName);
  const req = new IncomingMessage(new Socket());
  req.url = '/api/playground/execute';
  req.method = 'POST';
  req.headers = { host: '127.0.0.1:5173', 'content-type': 'application/json', ...(origin && { origin }) };
  req.push(JSON.stringify(body));
  req.push(null);
  const res = new ServerResponse(req);
  const head = vi.spyOn(res, 'writeHead').mockReturnValue(res);
  const end = vi.spyOn(res, 'end').mockReturnValue(res);
  try {
    await api.handle(req, res, () => {
      throw new Error('Unexpected fallthrough');
    });
    return { status: head.mock.calls[0]?.[0], body: JSON.parse(String(end.mock.calls[0]?.[0])) };
  } finally {
    api.close();
    req.destroy();
  }
}

describe('playground API', () => {
  it('builds without contacting DynamoDB', async () => {
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send');
    const result = await request({ command: 'get', source: stringify(examples[0]!.input), action: 'build' });
    expect(result.status).toBe(200);
    expect(result.body.builtInput).toMatchObject({ TableName: tableName, Key: { id: 'local-test-001' } });
    expect(send).not.toHaveBeenCalled();
  });
  it('builds from the JavaScript declaration shown in the editor', async () => {
    const source = `const input = ${stringify(examples[0]!.input)};`;
    const result = await request({ command: 'get', source, action: 'build' });
    expect(result.status).toBe(200);
    expect(result.body.builtInput).toMatchObject({ TableName: tableName, Key: { id: 'local-test-001' } });
  });
  it('executes the built SDK command and retains input on service failure', async () => {
    vi.spyOn(DynamoDBDocumentClient.prototype, 'send').mockRejectedValue(new Error('Database offline'));
    const result = await request({ command: 'get', source: stringify(examples[0]!.input), action: 'run' });
    expect(result.status).toBe(502);
    expect(result.body.phase).toBe('execute');
    expect(result.body.builtInput.TableName).toBe(tableName);
    expect(result.body.error.message).toBe('Database offline');
  });
  it('returns parse and builder failures without contacting DynamoDB', async () => {
    const send = vi.spyOn(DynamoDBDocumentClient.prototype, 'send');
    const malformed = await request({ command: 'get', source: '{', action: 'run' });
    expect(malformed.status).toBe(400);
    expect(malformed.body.phase).toBe('parse');
    const invalid = await request({ command: 'get', source: '{}', action: 'run' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.phase).toBe('build');
    expect(invalid.body.error.issues.length).toBeGreaterThan(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects unknown commands and cross-origin requests', async () => {
    expect((await request({ command: '__proto__', source: '{}', action: 'run' })).status).toBe(400);
    expect((await request({}, 'https://example.com')).status).toBe(403);
  });
  it('rejects non-local database endpoints', () => {
    expect(() => createApi('https://dynamodb.us-east-1.amazonaws.com', tableName)).toThrow('loopback');
  });
});
