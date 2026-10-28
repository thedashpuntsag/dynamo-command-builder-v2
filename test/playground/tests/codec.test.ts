import { describe, expect, it } from 'vite-plus/test';
import { parseInput, stringify } from '../src/server/codec';

describe('playground native value codec', () => {
  it('accepts object literal syntax and preserves nested sets, binary, and empty values', () => {
    const input = parseInput(`{
      // Valid JS object literal data without evaluating code.
      nested: [{ tags: { $set: ['a', 'b'] }, bytes: { $binary: 'SGVsbG8=' } }],
      numbers: { $set: [0, -2, 3.5] }, empty: '', nothing: null,
    }`) as { nested: { tags: Set<string>; bytes: Uint8Array }[] };
    expect(input.nested[0]?.tags).toEqual(new Set(['a', 'b']));
    expect(input.nested[0]?.bytes).toEqual(new TextEncoder().encode('Hello'));
    expect(parseInput(stringify(input))).toEqual(input);
    expect(parseInput(stringify(Buffer.from('Hello')))).toEqual(new TextEncoder().encode('Hello'));
  });
  it('accepts the playground const input declaration without evaluating JavaScript', () => {
    expect(parseInput("const input = { tableName: 'Orders', enabled: true };\n")).toEqual({
      tableName: 'Orders',
      enabled: true,
    });
    expect(() => parseInput("let input = { tableName: 'Orders' }")).toThrow();
    expect(() => parseInput("const other = { tableName: 'Orders' }")).toThrow();
  });
  it.each([
    '{x: {$set: []}}',
    '{x: {$set: [1, "a"]}}',
    '{x: {$binary: "?"}}',
    '{x: Infinity}',
    '{x: NaN}',
    '{x: process.exit()}',
  ])('rejects unsupported input: %s', (source) => {
    expect(() => parseInput(source)).toThrow();
  });
});
