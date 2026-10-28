/**
 * Returns a shallow copy containing only the source’s own enumerable string properties whose keys are not excluded.
 *
 * ### Process Flow:
 * 1. Create an empty result object.
 * 2. Iterate over enumerable keys, skipping inherited properties and excluded keys.
 * 3. Copy retained values by reference and return the result.
 *
 * @param obj - Source object to copy.
 * @param keys - Property keys to exclude from the copy.
 * @returns A new object typed as `Omit<T, K>`; nested values remain shared.
 *
 * @example
 * ```ts
 * const result = omit({ id: 'user-1', password: 'secret' }, ['password']);
 * // { id: 'user-1' }
 * ```
 */
export function omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = {} as Omit<T, K>;

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && !keys.includes(key as unknown as K)) {
      (result as Record<string, unknown>)[key] = obj[key];
    }
  }

  return result;
}
