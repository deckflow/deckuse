/**
 * OOXML ST_PlaceholderType values (ECMA-376).
 * Invalid `p:ph/@type` values make PowerPoint prompt to repair the package.
 */
export const PLACEHOLDER_TYPES = [
  'title',
  'body',
  'ctrTitle',
  'subTitle',
  'dt',
  'ftr',
  'sldNum',
  'hdr',
  'obj',
  'chart',
  'tbl',
  'clipArt',
  'dgm',
  'media',
  'sldImg',
  'pic',
] as const;

export type PlaceholderType = (typeof PLACEHOLDER_TYPES)[number];

const PLACEHOLDER_TYPE_SET = new Set<string>(PLACEHOLDER_TYPES);

/** Common agent/CLI aliases → canonical ST_PlaceholderType. */
const ROLE_ALIASES: Record<string, PlaceholderType> = {
  subtitle: 'subTitle',
  sub_title: 'subTitle',
  centertitle: 'ctrTitle',
  center_title: 'ctrTitle',
  ctrtitle: 'ctrTitle',
  slidenum: 'sldNum',
  slide_num: 'sldNum',
  slidenumber: 'sldNum',
  datetime: 'dt',
  date: 'dt',
  footer: 'ftr',
  header: 'hdr',
  table: 'tbl',
  diagram: 'dgm',
  slideimage: 'sldImg',
  slide_image: 'sldImg',
  picture: 'pic',
  object: 'obj',
  clipart: 'clipArt',
  clip_art: 'clipArt',
};

export type NormalizePlaceholderRoleResult =
  | { ok: true; type: PlaceholderType }
  | { ok: false; message: string };

/**
 * Normalize a user/agent `role` into a valid `p:ph/@type`.
 * Accepts canonical types case-sensitively and common lowercase aliases.
 */
export function normalizePlaceholderRole(role: string): NormalizePlaceholderRoleResult {
  const trimmed = role.trim();
  if (!trimmed)
    return { ok: false, message: 'Placeholder role must be a non-empty string' };

  if (PLACEHOLDER_TYPE_SET.has(trimmed))
    return { ok: true, type: trimmed as PlaceholderType };

  const alias = ROLE_ALIASES[trimmed.toLowerCase()];
  if (alias) return { ok: true, type: alias };

  // Case-insensitive match for canonical names (e.g. SubTitle → subTitle).
  const lower = trimmed.toLowerCase();
  for (const type of PLACEHOLDER_TYPES) {
    if (type.toLowerCase() === lower) return { ok: true, type };
  }

  return {
    ok: false,
    message: `Invalid placeholder role "${role}". Use an OOXML ST_PlaceholderType (${PLACEHOLDER_TYPES.join(', ')}) or a known alias (subtitle→subTitle, centertitle→ctrTitle, …). Avoid non-OOXML labels like "card" or "image" — they make PowerPoint repair the file.`,
  };
}
