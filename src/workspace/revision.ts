/** Monotonic integer revision as a decimal string (index/manifest stay string-typed). */
export const INITIAL_REVISION = '1';

export const revision = (): string => INITIAL_REVISION;

export const nextRevision = (current: string): string => {
  const n = Number(current);
  if (Number.isInteger(n) && n >= 0) return String(n + 1);
  // Legacy non-integer revisions: start a new integer line after the write.
  return INITIAL_REVISION;
};

export const isIntegerRevision = (value: string): boolean => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && String(n) === value;
};
