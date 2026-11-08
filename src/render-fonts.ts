import { OpcArchive } from './opc/index.js';
import type { IndexFile } from './pptx/types.js';
import { buildIndex } from './pptx/indexer.js';
import { nodeFor } from './pptx/node-for.js';
import { descendants, NS } from './pptx/xml.js';
import type { Diagnostic } from './core/index.js';
export interface TextFontUsage {
  target: string;
  text: string;
  fonts: string[];
  cjk: boolean;
  inheritance: string;
}
export interface FontInventory {
  usages: TextFontUsage[];
  themeFonts: string[];
  source: string;
  scope: string;
}
const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u;
export async function renderFontInventory(
  file: string,
  format: 'pptx' | 'docx',
  page: number,
  archive?: OpcArchive,
  pptxIndex?: IndexFile,
): Promise<FontInventory> {
  archive ??= await OpcArchive.openFile(file);
  const usages: TextFontUsage[] = [];
  const themeFonts = new Set<string>();
  for (const uri of archive.parts.keys()) {
    if (!/\/theme\/.*\.xml$/.test(uri)) continue;
    for (const font of descendants(archive.readXml(uri), 'latin').concat(
      descendants(archive.readXml(uri), 'ea'),
      descendants(archive.readXml(uri), 'cs'),
      descendants(archive.readXml(uri), 'font'),
    )) {
      const family = font.getAttribute('typeface');
      if (family) themeFonts.add(family);
    }
  }
  if (format === 'pptx') {
    const index = pptxIndex ?? buildIndex(archive, 'render-fonts', '0');
    const slide = index.elements.filter((e) => e.kind === 'slide')[page - 1];
    if (slide) {
      const doc = archive.readXml(slide.partUri);
      for (const item of index.elements.filter(
        (e) =>
          e.partUri === slide.partUri &&
          e.kind !== 'slide' &&
          e.kind !== 'group' &&
          e.kind !== 'notes',
      )) {
        const node = nodeFor(doc, item);
        if (!node) continue;
        const text = descendants(node, 'p')
          .map((p) =>
            descendants(p, 't')
              .filter((n) => n.namespaceURI === NS.a)
              .map((n) => n.textContent ?? '')
              .join(''),
          )
          .join('\n');
        if (!text) continue;
        const fonts = [
          ...new Set(
            ['latin', 'ea', 'cs'].flatMap((tag) =>
              descendants(node, tag)
                .map((n) => n.getAttribute('typeface'))
                .filter((v): v is string => Boolean(v)),
            ),
          ),
        ];
        usages.push({
          target: `slide:${String(page)}/shape:${item.name ?? item.ref.elementId ?? 'unknown'}`,
          text,
          fonts,
          cjk: cjk.test(text),
          inheritance: fonts.length
            ? 'explicit or theme token; per-character inheritance not fully resolved'
            : 'layout/master/theme inheritance unresolved',
        });
      }
    }
  } else {
    const doc = archive.readXml('/word/document.xml');
    for (const [i, paragraph] of descendants(doc, 'p').entries()) {
      const text = descendants(paragraph, 't')
        .map((n) => n.textContent ?? '')
        .join('');
      if (!text) continue;
      const fonts = [
        ...new Set(
          descendants(paragraph, 'rFonts').flatMap((n) =>
            ['ascii', 'hAnsi', 'eastAsia', 'cs']
              .map((a) =>
                n.getAttributeNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', a),
              )
              .filter((v): v is string => Boolean(v)),
          ),
        ),
      ];
      usages.push({
        target: `document/paragraph:${String(i + 1)}`,
        text,
        fonts,
        cjk: cjk.test(text),
        inheritance: 'style/theme inheritance and HTML page mapping not resolved',
      });
    }
  }
  return {
    usages,
    themeFonts: [...themeFonts],
    source: 'input OOXML',
    scope:
      format === 'pptx'
        ? `slide ${String(page)} and package theme candidates`
        : 'whole document; not mapped to HTML pages',
  };
}
export function fontRiskReport(
  inventory: FontInventory,
  converterLog: string,
  page: number,
  browserText?: string,
) {
  const unresolved = [
    ...new Set(
      [...converterLog.matchAll(/\[font\]\s+unresolved\s+'([^']+)'/g)]
        .map((m) => m[1] ?? '')
        .filter(Boolean),
    ),
  ];
  const diagnostics: Diagnostic[] = [];
  for (const family of unresolved) {
    const targets = inventory.usages.filter((u) => u.fonts.includes(family)).map((u) => u.target);
    diagnostics.push({
      severity: 'warning',
      code: 'FONT_UNRESOLVED',
      message: `Converter could not resolve font "${family}"; confirm availability/fallback and rerender. This is not proof of OS font absence.`,
      details: {
        page,
        targets,
        family,
        source: 'deck2html conversion log',
        scope: 'converter run; may include unused theme candidates',
        glyphCoverage: 'unknown',
        substitution: 'unknown',
      },
    });
  }
  for (const usage of inventory.usages.filter((u) => u.cjk)) {
    diagnostics.push({
      severity: 'warning',
      code: usage.fonts.length
        ? 'CJK_GLYPH_COVERAGE_UNVERIFIED'
        : 'CJK_FONT_INHERITANCE_UNVERIFIED',
      message:
        'CJK font inheritance/fallback and glyph coverage need rendered review; explicitly select a confirmed family when appropriate.',
      details: {
        page,
        target: usage.target,
        fonts: usage.fonts,
        source: inventory.source,
        inheritance: usage.inheritance,
      },
    });
  }
  const normalize = (s: string) => s.replace(/\s+/gu, '');
  const comparable = inventory.scope.startsWith('slide ') && browserText !== undefined;
  const missing = comparable
    ? inventory.usages
        .filter(
          (u) =>
            !u.text
              .split('\n')
              .filter(Boolean)
              .every((segment) => normalize(browserText).includes(normalize(segment))),
        )
        .map((u) => u.target)
    : [];
  if (missing.length)
    diagnostics.push({
      severity: 'warning',
      code: 'RENDER_TEXT_CONTENT_UNVERIFIED',
      message:
        'Some input object text was not found in rendered DOM text. Inspect conversion, hidden content and clipping before delivery.',
      details: {
        page,
        targets: missing,
        source: 'input OOXML versus browser innerText',
        heuristic: true,
      },
    });
  return {
    diagnostics,
    report: {
      source: inventory.source,
      scope: inventory.scope,
      fonts: inventory.usages.map((usage) => ({
        target: usage.target,
        fonts: usage.fonts,
        cjk: usage.cjk,
        inheritance: usage.inheritance,
      })),
      themeCandidates: inventory.themeFonts,
      unresolved,
      availabilitySource: 'deck2html resolver; OS installation not queried',
      fontAvailability: unresolved.length ? 'resolver-unresolved' : 'unknown',
      glyphCoverage: 'unknown',
      substitution: 'unknown',
      textContent: {
        source: 'browser innerText versus input OOXML',
        status: comparable ? (missing.length ? 'mismatch-needs-review' : 'text-found') : 'unknown',
        missingTargets: missing,
        visibilityAndClipping: 'unverified',
      },
      recommendation:
        'Check chosen and fallback fonts on render/Office hosts, rerender affected pages and perform native review; do not infer visual approval from PNG success.',
    },
  };
}
