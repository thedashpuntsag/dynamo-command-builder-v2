/**
 * Decodes a decimal DynamoDB number without silently rounding its textual value.
 *
 * ### Process Flow:
 * 1. Normalize decimal/scientific notation into a signed coefficient and exponent.
 * 2. Check DynamoDB's precision and magnitude limits.
 * 3. Return safe integers as numbers and larger integral values as bigints.
 * 4. Accept fractional numbers only when their shortest decimal round-trip matches the input.
 *
 * @param value - Decimal or scientific-notation number text.
 * @returns A number or an exact bigint for integral values outside the safe number range.
 * @throws If syntax, precision, range, or native decimal representation is unsupported.
 * @example
 * ```ts
 * parseDynamoNumber('1e3'); // 1000
 * parseDynamoNumber('9007199254740993'); // 9007199254740993n
 * ```
 */
export function parseDynamoNumber(value: string): number | bigint {
  /**
   * Canonicalizes number text for exact decimal comparison.
   *
   * ### Process Flow:
   * 1. Parse sign, digits, fraction, and exponent.
   * 2. Strip insignificant zeros and adjust the exponent.
   *
   * @param text - Number text to normalize.
   * @returns The sign, significant digits, and base-ten exponent.
   * @throws If syntax or the exponent is invalid.
   */
  const normalize = (text: string) => {
    const match = /^([+-]?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!match) throw new Error('Invalid DynamoDB number.');
    const fraction = match[3] ?? '';
    let exponent = Number(match[4] ?? 0) - fraction.length;
    if (!Number.isSafeInteger(exponent)) throw new Error('Invalid DynamoDB number exponent.');
    let digits = `${match[2]}${fraction}`.replace(/^0+/, '');
    if (!digits) return { negative: false, digits: '0', exponent: 0 };
    const trailing = digits.length - digits.replace(/0+$/, '').length;
    digits = digits.slice(0, digits.length - trailing);
    exponent += trailing;
    return { negative: match[1] === '-', digits, exponent };
  };
  const normalized = normalize(value);
  const { digits, exponent, negative } = normalized;
  const magnitude = digits.length + exponent - 1;
  if (digits.length > 38 || (digits !== '0' && (magnitude < -130 || magnitude > 125))) {
    throw new Error('DynamoDB number exceeds its 38-digit precision or supported range.');
  }
  if (exponent >= 0) {
    const integer = BigInt(`${negative ? '-' : ''}${digits}`) * 10n ** BigInt(exponent);
    return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(integer)
      : integer;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || JSON.stringify(normalize(String(number))) !== JSON.stringify(normalized)) {
    throw new Error('DynamoDB decimal cannot be represented without precision loss.');
  }
  return number;
}
