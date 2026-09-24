import { err, ok, type AtomicCommand, type Result } from '../core/index.js';
import type { OpcArchive } from '../opc/index.js';
import type { Document, Element } from '@xmldom/xmldom';
import { hitsFrom, locate, matchesSelector, readDocument } from './indexer.js';
import {
  assertBookmarkName,
  blockAnchor,
  bookmarkExists,
  createPageBreak,
  createParagraphs,
  ensureParaId,
  fillParagraph,
  insertAfter,
  nextBookmarkId,
  removeBookmark,
  removeElement,
  setPlainText,
} from './paragraphs.js';
import { applyProperties, styleExists } from './properties.js';
import { replaceInParagraph } from './text-spans.js';
import { createTable, tableRowsValid } from './tables.js';
import type { IndexFile, MutationOutcome } from './types.js';
import { DOCUMENT_PART, children, protectionReason, wEl, writeTextNode } from './xml.js';

const SLIDE_COMMANDS = new Set<AtomicCommand['type']>([
  'setTransform',
  'xfrmSet',
  'setTableLayout',
  'zMove',
  'alignElements',
  'add',
  'addSlide',
  'setSlideLayout',
  'addShape',
  'replacePicture',
  'duplicate',
]);

const HINT =
  'Word documents are a flow, not a slide canvas. Use addParagraph, addTable, insertBreak, setText, or setProperties.';

const outcome = (
  changed: boolean,
  targets: string[],
  extras: Partial<MutationOutcome> = {},
): MutationOutcome => ({
  changed,
  changedTargets: targets,
  changedParts: changed ? [DOCUMENT_PART] : [],
  slides: [],
  ...extras,
});

const save = (archive: OpcArchive, doc: Document): void => {
  archive.writeXml(DOCUMENT_PART, doc);
};

const targetOf = (command: {
  target?: string | undefined;
  ref?: { path?: string | undefined; elementId?: string | undefined } | undefined;
}): string | undefined => command.target ?? command.ref?.path ?? command.ref?.elementId;

const requireDocument = (archive: OpcArchive): Result<Document> => {
  const doc = readDocument(archive);
  if (!doc) return err('DOCUMENT_NOT_FOUND', 'word/document.xml is missing');
  return ok(doc);
};

const styleFor = (
  archive: OpcArchive,
  style: string | undefined,
  level: number | undefined,
): Result<string | undefined> => {
  const styleId =
    style ?? (level === undefined ? undefined : level === 0 ? 'Normal' : `Heading${String(level)}`);
  if (!styleId) return ok(undefined);
  if (!styleExists(archive, styleId)) {
    return err('TARGET_NOT_FOUND', `Style not found: ${styleId}`, [], {
      target: `style:${styleId}`,
      hint: 'deckuse list styles shows ids already in the document. Style definitions are not created.',
    });
  }
  return ok(styleId);
};

const anchorFor = (
  archive: OpcArchive,
  index: IndexFile,
  after: string | undefined,
): Result<{ doc: Document; anchor?: Element }> => {
  if (!after) {
    const loaded = requireDocument(archive);
    if (!loaded.ok) return loaded;
    return ok({ doc: loaded.value });
  }
  const located = locate(archive, index, after);
  if (!located.ok) return located;
  if (located.value.partUri !== DOCUMENT_PART) {
    return err('INVALID_COMMAND', `Cannot insert after ${after}`, [], {
      hint: 'Insert after a paragraph, table, or bookmark in the document body.',
    });
  }
  const anchor = blockAnchor(located.value.element);
  if (anchor.localName === 'sectPr' || located.value.item.kind === 'style') {
    return err('INVALID_COMMAND', `Cannot insert after ${after}`);
  }
  return ok({ doc: located.value.doc, anchor });
};

export function mutate(
  command: AtomicCommand,
  archive: OpcArchive,
  index: IndexFile,
): Result<MutationOutcome> {
  if (SLIDE_COMMANDS.has(command.type)) {
    return err('UNSUPPORTED_CAPABILITY', `${command.type} is a slide command`, [], { hint: HINT });
  }

  if (command.type === 'setText') {
    const target = targetOf(command);
    if (!target) return err('INVALID_COMMAND', 'setText requires target or ref');
    const located = locate(archive, index, target);
    if (!located.ok) return located;
    const { element, doc } = located.value;
    if (element.localName === 'r') {
      if (command.blocks)
        return err('INVALID_COMMAND', 'blocks require a paragraph target', [], {
          hint: 'Target the paragraph, not a single run.',
        });
      const text = command.text ?? command.value;
      if (text === undefined)
        return err('INVALID_COMMAND', 'setText requires text, value, or blocks');
      if (text.includes('\n'))
        return err('INVALID_COMMAND', 'Run text cannot contain newlines', [], {
          hint: 'Target the paragraph to write multiple paragraphs.',
        });
      const reason = protectionReason(element);
      if (reason) return err('UNSUPPORTED_CAPABILITY', reason, [], { target });
      for (const child of [...children(element)]) {
        if (child.localName === 't') element.removeChild(child);
      }
      const textNode = wEl(doc, 't');
      writeTextNode(textNode, text);
      element.appendChild(textNode);
      save(archive, doc);
      return ok(outcome(true, [target]));
    }
    if (element.localName !== 'p')
      return err('INVALID_COMMAND', 'setText targets a paragraph or run', [], {
        target,
        hint: HINT,
      });
    if (command.blocks) {
      const first = command.blocks[0];
      if (!first) return err('INVALID_COMMAND', 'setText blocks must not be empty');
      const filled = fillParagraph(element, first);
      if (!filled.ok) return filled;
      const rest = command.blocks.slice(1);
      const created = createParagraphs(doc, { blocks: rest });
      if (!created.ok) return created;
      insertAfter(element, created.value, doc);
      save(archive, doc);
      return ok(outcome(true, [target]));
    }
    const text = command.text ?? command.value ?? '';
    const replaced = setPlainText(element, text);
    if (!replaced.ok) return replaced;
    insertAfter(element, replaced.value, doc);
    save(archive, doc);
    return ok(outcome(true, [target]));
  }

  if (command.type === 'replaceText') {
    const loaded = requireDocument(archive);
    if (!loaded.ok) return loaded;
    const doc = loaded.value;
    let matched = 0;
    const limit = command.limit;
    for (const hit of hitsFrom(doc, undefined)) {
      if (hit.kind !== 'paragraph') continue;
      if (command.selector) {
        const item = index.elements.find((entry) => entry.ref.path === hit.path);
        if (!item || !matchesSelector(item, command.selector)) continue;
      }
      const remaining = limit !== undefined ? limit - matched : undefined;
      if (remaining !== undefined && remaining <= 0) break;
      const replaced = replaceInParagraph(
        hit.element,
        command.find,
        command.replace,
        command.regex ?? false,
        remaining,
      );
      if ('error' in replaced) {
        return err('UNSUPPORTED_CAPABILITY', replaced.error, [], {
          target: hit.path,
          hint: 'replaceText matches inside one paragraph and will not rewrite protected markup.',
        });
      }
      if (replaced.matched > 0) ensureParaId(hit.element);
      matched += replaced.matched;
    }
    if (matched > 0) save(archive, doc);
    return ok(
      outcome(matched > 0, matched > 0 ? [DOCUMENT_PART] : [], { matched }),
      matched === 0
        ? [
            {
              severity: 'warning',
              code: 'REPLACE_TEXT_NO_MATCH',
              message: 'replaceText matched no text',
            },
          ]
        : [],
    );
  }

  if (command.type === 'set' || command.type === 'setProperties') {
    if (command.scope && command.scope !== 'local') {
      return err('UNSUPPORTED_CAPABILITY', `scope ${command.scope} is not available for DOCX`, [], {
        hint: 'Apply paragraph.style on a body paragraph. Style, theme, and numbering definitions are not writable.',
      });
    }
    const target = targetOf(command);
    if (!target) return err('INVALID_COMMAND', 'setProperties requires target or ref');
    const located = locate(archive, index, target);
    if (!located.ok) return located;
    const reason = protectionReason(located.value.element);
    if (reason) return err('UNSUPPORTED_CAPABILITY', reason, [], { target });
    const applied = applyProperties(
      archive,
      located.value.element,
      located.value.item.kind,
      command.properties,
    );
    if (!applied.ok) return applied;
    if (located.value.element.localName === 'p') ensureParaId(located.value.element);
    if (located.value.partUri === DOCUMENT_PART) save(archive, located.value.doc);
    return ok(outcome(true, [target]));
  }

  if (command.type === 'remove') {
    const target = targetOf(command);
    if (!target) return err('INVALID_COMMAND', 'remove requires target or ref');
    const located = locate(archive, index, target);
    if (!located.ok) return located;
    if (located.value.item.kind === 'bookmark') {
      const name = located.value.item.name;
      if (!name) return err('TARGET_NOT_FOUND', `Bookmark not found: ${target}`);
      const removed = removeBookmark(located.value.doc, name);
      if (!removed.ok) return removed;
      save(archive, located.value.doc);
      return ok(outcome(true, [target]));
    }
    if (located.value.item.kind === 'style' || located.value.item.kind === 'section') {
      return err('UNSUPPORTED_CAPABILITY', `Cannot remove ${located.value.item.kind}`, [], {
        hint: HINT,
      });
    }
    if (located.value.element.localName === 'tc') {
      return err('INVALID_COMMAND', 'Cannot remove a single table cell', [], {
        target,
        hint: 'Remove a paragraph, a row, or the whole table.',
      });
    }
    const reason = protectionReason(located.value.element);
    if (reason && located.value.element.localName !== 'tbl')
      return err('UNSUPPORTED_CAPABILITY', reason, [], { target });
    const removed = removeElement(located.value.element);
    if (!removed.ok) return removed;
    save(archive, located.value.doc);
    return ok(outcome(true, [target]));
  }

  if (command.type === 'addParagraph') {
    const placed = anchorFor(archive, index, command.after);
    if (!placed.ok) return placed;
    const styleId = styleFor(archive, command.style, command.level);
    if (!styleId.ok) return styleId;
    let bookmark: { id: string; name: string } | undefined;
    if (command.name) {
      const valid = assertBookmarkName(command.name);
      if (!valid.ok) return valid;
      if (bookmarkExists(placed.value.doc, command.name))
        return err('AMBIGUOUS_NAME', `Bookmark already exists: ${command.name}`, [], {
          target: `bookmark:${command.name}`,
        });
      bookmark = { id: nextBookmarkId(placed.value.doc), name: command.name };
    }
    const created = createParagraphs(placed.value.doc, {
      ...(command.text !== undefined ? { text: command.text } : {}),
      ...(command.blocks ? { blocks: command.blocks } : {}),
      ...(styleId.value ? { styleId: styleId.value } : {}),
      ...(bookmark ? { bookmark } : {}),
    });
    if (!created.ok) return created;
    insertAfter(placed.value.anchor, created.value, placed.value.doc);
    save(archive, placed.value.doc);
    return ok(
      outcome(true, command.name ? [`bookmark:${command.name}`] : created.value.map(() => 'body')),
    );
  }

  if (command.type === 'addTable') {
    const invalid = tableRowsValid(command.rows);
    if (invalid) return err('INVALID_COMMAND', invalid);
    const placed = anchorFor(archive, index, command.after);
    if (!placed.ok) return placed;
    const doc = placed.value.doc;
    const table = createTable(doc, command.rows);
    const nodes: Element[] = [table];
    if (command.name) {
      const valid = assertBookmarkName(command.name);
      if (!valid.ok) return valid;
      if (bookmarkExists(doc, command.name))
        return err('AMBIGUOUS_NAME', `Bookmark already exists: ${command.name}`);
      const id = nextBookmarkId(doc);
      const start = wEl(doc, 'bookmarkStart');
      start.setAttribute('w:id', id);
      start.setAttribute('w:name', command.name);
      const end = wEl(doc, 'bookmarkEnd');
      end.setAttribute('w:id', id);
      nodes.unshift(start);
      nodes.push(end);
    }
    insertAfter(placed.value.anchor, nodes, doc);
    save(archive, doc);
    return ok(outcome(true, command.name ? [`bookmark:${command.name}`] : ['body']));
  }

  if (command.type === 'insertBreak') {
    const placed = anchorFor(archive, index, command.after);
    if (!placed.ok) return placed;
    const paragraph = createPageBreak(placed.value.doc);
    insertAfter(placed.value.anchor, [paragraph], placed.value.doc);
    save(archive, placed.value.doc);
    return ok(outcome(true, ['body']));
  }

  return err('UNSUPPORTED_CAPABILITY', `${command.type} is not available for DOCX`, [], {
    hint: HINT,
  });
}
