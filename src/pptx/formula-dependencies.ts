import type { OpcArchive } from '../opc/index.js';
import { NS, descendants, first } from './xml.js';
export class WorkbookDependencyError extends Error {
  readonly details: Record<string, unknown>;
  constructor(
    code: string,
    cell: { sheet: string; address: string },
    formula = '',
    source?: { sheet: string; address: string },
  ) {
    super(
      `${code}: ${source ? `${source.sheet}!${source.address} -> ` : ''}${cell.sheet}!${cell.address}: ${formula}`,
    );
    this.details = {
      reasonCode: code,
      cell: source ?? cell,
      ...(source ? { dependentCell: cell } : {}),
      formula,
    };
  }
}
/** A deliberately bounded dependency parser. Unrecognized syntax cannot establish safety. */
export function assertIndependentFormulas(
  book: OpcArchive,
  changes: { sheet: string; address: string }[],
) {
  const workbook = book.readXml('/xl/workbook.xml');
  if (descendants(workbook, 'definedName').length)
    throw new Error('WORKBOOK_NAMED_DEPENDENCY_UNSUPPORTED');
  for (const sheet of descendants(workbook, 'sheet')) {
    const name = sheet.getAttribute('name') ?? '',
      rid = sheet.getAttributeNS(NS.r, 'id');
    const part = book
      .getRelationships('/xl/workbook.xml')
      .find((r) => r.id === rid)?.resolvedTarget;
    if (!part) throw new Error('WORKBOOK_SHEET_UNRESOLVED');
    for (const cell of descendants(book.readXml(part), 'c')) {
      const f = first(cell, 'f');
      if (!f) continue;
      const address = cell.getAttribute('r') ?? '';
      if (f.hasAttribute('t') || f.hasAttribute('ref'))
        throw new WorkbookDependencyError(
          'WORKBOOK_FORMULA_KIND_UNSUPPORTED',
          { sheet: name, address },
          f.textContent ?? '',
        );
      if (changes.some((c) => c.sheet === name && c.address === address))
        throw new WorkbookDependencyError(
          'WORKBOOK_FORMULA_TARGET',
          { sheet: name, address },
          f.textContent ?? '',
        );
      let formula = f.textContent ?? '';
      formula = formula.replace(/"(?:[^"]|"")*"/g, '0');
      const dependencies: { sheet: string; from: string; to: string }[] = [];
      formula = formula.replace(
        /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_ ]*))!)?(\$?[A-Z]{1,3}\$?[1-9]\d*)(?::(\$?[A-Z]{1,3}\$?[1-9]\d*))?/g,
        (
          _all: string,
          quoted: string | undefined,
          plain: string | undefined,
          a: string,
          b: string | undefined,
        ) => {
          dependencies.push({
            sheet: quoted?.replaceAll("''", "'") ?? plain ?? name,
            from: a.replaceAll('$', ''),
            to: (b ?? a).replaceAll('$', ''),
          });
          return '0';
        },
      );
      formula = formula.replace(
        /\b(?:SUM|AVERAGE|MIN|MAX|COUNT|COUNTA|IF|AND|OR|NOT|ABS|ROUND|ROUNDUP|ROUNDDOWN)\s*\(/gi,
        '(',
      );
      if (!/^[\d\s.eE+\-*/^(),;%=<>]*$/.test(formula))
        throw new WorkbookDependencyError(
          'WORKBOOK_FORMULA_UNRESOLVED',
          { sheet: name, address },
          f.textContent ?? '',
        );
      const xy = (a: string) => {
        const m = /^([A-Z]+)(\d+)$/.exec(a);
        if (!m) throw new Error('WORKBOOK_REFERENCE_INVALID');
        let col = 0;
        for (const c of m[1] ?? '') col = col * 26 + c.charCodeAt(0) - 64;
        return [col, Number(m[2])] as const;
      };
      for (const d of dependencies) {
        const [c1, r1] = xy(d.from),
          [c2, r2] = xy(d.to);
        for (const change of changes) {
          const [c, r] = xy(change.address);
          if (
            change.sheet === d.sheet &&
            c >= Math.min(c1, c2) &&
            c <= Math.max(c1, c2) &&
            r >= Math.min(r1, r2) &&
            r <= Math.max(r1, r2)
          )
            throw new WorkbookDependencyError(
              'WORKBOOK_FORMULA_DEPENDENCY',
              { sheet: name, address },
              f.textContent ?? '',
              { sheet: change.sheet, address: change.address },
            );
        }
      }
    }
  }
}
