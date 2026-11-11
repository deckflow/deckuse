/** Expand one field, leaving cycle references explicit rather than recursing forever. */
export function schemaField(schema: unknown, field: string): unknown {
  const root = schema as { properties?: Record<string, unknown>; $defs?: Record<string, unknown> };
  if (!root.properties || !Object.hasOwn(root.properties, field))
    throw new Error(`Unknown schema field: ${field}`);
  function expand(value: unknown, seen = new Set<string>()): unknown {
    if (Array.isArray(value)) return value.map((v) => expand(v, seen));
    if (!value || typeof value !== 'object') return value;
    const entry = value as Record<string, unknown>;
    const ref = entry['$ref'];
    if (typeof ref === 'string') {
      const definition = root.$defs?.[ref.replace(/^#\/\$defs\//, '')];
      if (!ref.startsWith('#/$defs/') || !definition || seen.has(ref)) return entry;
      return expand(definition, new Set([...seen, ref]));
    }
    return Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, expand(v, seen)]));
  }
  return expand(root.properties[field]);
}
