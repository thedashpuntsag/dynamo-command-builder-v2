import JSON5 from 'json5';

/** JSON5 object literals with explicit, round-trippable tags for DynamoDB native types. */
export function parseInput(source: string): unknown {
  return JSON5.parse(source, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('DynamoDB numbers must be finite.');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const object = value as Record<string, unknown>;
    if (Object.keys(object).length !== 1) return value;
    if ('$set' in object) {
      if (!Array.isArray(object.$set) || object.$set.length === 0) {
        throw new Error('$set must contain a non-empty array.');
      }
      const entries: unknown[] = object.$set;
      const kind = typeof entries[0];
      if (!['string', 'number'].includes(kind) || entries.some((entry) => typeof entry !== kind)) {
        throw new Error('$set must contain only strings or only numbers.');
      }
      return new Set(entries);
    }
    if ('$binary' in object) {
      if (
        typeof object.$binary !== 'string' ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(object.$binary)
      ) {
        throw new Error('$binary must be a base64 string.');
      }
      return Uint8Array.from(atob(object.$binary), (character) => character.charCodeAt(0));
    }
    return value;
  });
}

export function stringify(value: unknown): string {
  return (
    JSON.stringify(
      value,
      (_key, entry: unknown) => {
        if (entry instanceof Set) return { $set: [...entry] };
        if (entry instanceof Uint8Array) {
          return { $binary: btoa(Array.from(entry, (byte) => String.fromCharCode(byte)).join('')) };
        }
        // Buffer.toJSON runs before the replacer.
        if (
          entry &&
          typeof entry === 'object' &&
          'type' in entry &&
          entry.type === 'Buffer' &&
          'data' in entry &&
          Array.isArray(entry.data)
        ) {
          return { $binary: btoa(String.fromCharCode(...entry.data)) };
        }
        if (typeof entry === 'bigint') return entry.toString();
        return entry;
      },
      2
    ) ?? 'null'
  );
}
