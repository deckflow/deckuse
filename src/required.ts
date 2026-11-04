/** Enforce an internal invariant before using an indexed or optional value. */
export function requireDefined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected a defined value');
  return value;
}
