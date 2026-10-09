import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { coarsePlace, FIND_CHOICE_LIMIT, truncateFindText } from '../../src/find/catalog.js';
import {
  injectFindClient,
  type FindAnswer,
  type FindCall,
  type FindResponse,
} from '../../src/find/client.js';
import { rankFind } from '../../src/find/rank.js';
import type { FindCandidate } from '../../src/find/catalog.js';
import { resolveHelp } from '../../src/help.js';
import { buildBlankArchive, docxAdapter } from '../../src/docx/index.js';
import { pptxAdapter } from '../../src/pptx/index.js';

const encoder = new TextEncoder();

afterEach(() => {
  injectFindClient(undefined);
});

const candidate = (index: number, container = 'slide 1'): FindCandidate => ({
  target: `t-${String(index)}`,
  kind: 'shape',
  container,
  name: `N${String(index)}`,
});

const many = (count: number, container = 'slide 1'): FindCandidate[] =>
  Array.from({ length: count }, (_, index) => candidate(index, container));

const reply = (
  answers: Record<string, FindAnswer>,
  usage: { input_tokens: number; output_tokens: number } = { input_tokens: 1, output_tokens: 1 },
): FindResponse => ({ model: 'jev-test', answers, usage });

const elementsOf = (
  call: FindCall,
): { id: string; name?: string; text?: string; place?: string; kind?: string }[] => {
  const elements = call.state['elements'];
  return Array.isArray(elements)
    ? (elements as { id: string; name?: string; text?: string; place?: string; kind?: string }[])
    : [];
};

const choice = (probabilities: Record<string, number>, winner: string): FindAnswer => ({
  type: 'choice',
  choice: winner,
  probabilities,
});

describe('find catalog', () => {
  it('assigns stable ids, truncates text, and keeps a name and place without body text', async () => {
    expect(truncateFindText('a'.repeat(300))?.length).toBe(240);
    expect(truncateFindText('a'.repeat(300))?.endsWith('…')).toBe(true);
    expect(coarsePlace({ x: 10_000_000, y: 200_000, width: 1_000_000, height: 500_000 })).toBe(
      'top-right',
    );
    expect(coarsePlace({ x: 5_000_000, y: 3_000_000, width: 1_000_000, height: 1_000_000 })).toBe(
      'center',
    );
    expect(coarsePlace({ x: 5_000_000, y: 6_000_000, width: 1_000_000, height: 400_000 })).toBe(
      'bottom',
    );

    let captured: FindCall | undefined;
    const ranked = await rankFind({
      query: 'logo',
      candidates: [
        {
          target: 'slide:1/shape:5',
          kind: 'picture',
          container: 'slide 1',
          name: 'Logo',
          place: 'top-right',
          text: '字'.repeat(300),
        },
        {
          target: 'slide:1/shape:9',
          kind: 'chart',
          container: 'slide 1',
          name: 'Chart',
          place: 'bottom',
        },
      ],
      client: (call) => {
        captured = call;
        const logo = elementsOf(call).find((item) => item.name === 'Logo');
        return Promise.resolve(
          reply({
            where: choice({ E001: 0.2, E002: 0.8 }, 'E002'),
            exists: { type: 'noul', noul: 0.91 },
          }),
        ).then((response) => {
          expect(logo?.id).toBe('E001');
          return response;
        });
      },
    });
    const rows = captured ? elementsOf(captured) : [];
    expect(rows[0]?.text?.length).toBe(240);
    expect(rows[0]?.place).toBe('top-right');
    expect(rows[1]?.name).toBe('Chart');
    expect(rows[1]?.place).toBe('bottom');
    expect(rows[1]?.text).toBeUndefined();
    expect(ranked.ok).toBe(true);
  });
});

describe('find ranking', () => {
  it('returns the high-probability element when the document answers the query', async () => {
    const ranked = await rankFind({
      query: 'who owns the code',
      limit: 2,
      candidates: many(3),
      client: () =>
        Promise.resolve(
          reply({
            where: choice({ E001: 0.15, E002: 0.8, E003: 0.05 }, 'E002'),
            exists: { type: 'noul', noul: 0.95 },
          }),
        ),
    });
    expect(ranked.ok).toBe(true);
    if (!ranked.ok) return;
    expect(Object.keys(ranked.value)).toEqual(['matches']);
    expect(ranked.value.matches.map((item) => item.target)).toEqual(['t-1', 't-0']);
    expect(ranked.value.matches[0]).not.toHaveProperty('score');
  });

  it('keeps a clear hit when the yes/no score is low and drops zero-score siblings', async () => {
    const ranked = await rankFind({
      query: 'logo图片',
      candidates: many(3),
      client: () =>
        Promise.resolve(
          reply({
            where: choice({ E001: 1, E002: 0, E003: 0 }, 'E001'),
            exists: { type: 'noul', noul: 0.35 },
          }),
        ),
    });
    expect(ranked.ok).toBe(true);
    if (!ranked.ok) return;
    expect(ranked.value.matches.map((item) => item.target)).toEqual(['t-0']);
  });

  it('returns the best element when the answer is only partial', async () => {
    const ranked = await rankFind({
      query: 'parental permission',
      candidates: many(1),
      client: () =>
        Promise.resolve(
          reply({
            where: choice({ E001: 1 }, 'E001'),
            exists: { type: 'noul', noul: 0.46 },
          }),
        ),
    });
    expect(ranked.ok).toBe(true);
    if (!ranked.ok) return;
    expect(ranked.diagnostics).toEqual([]);
    expect(ranked.value.matches).toEqual([{ target: 't-0', kind: 'shape', name: 'N0' }]);
  });

  it('does not call TypeSafe when there are no candidates', async () => {
    let calls = 0;
    const ranked = await rankFind({
      query: 'anything',
      candidates: [],
      client: () => {
        calls += 1;
        return Promise.reject(new Error('should not be called'));
      },
    });
    expect(calls).toBe(0);
    expect(ranked.ok).toBe(true);
    if (!ranked.ok) return;
    expect(ranked.value).toEqual({ matches: [] });
  });

  it('rescores heads with noul when a window exceeds the choice limit', async () => {
    const calls: FindCall[] = [];
    const count = FIND_CHOICE_LIMIT + 50;
    const ranked = await rankFind({
      query: 'revenue card',
      candidates: many(count),
      client: (call) => {
        calls.push(call);
        const containers = call.state['containers'];
        if (Array.isArray(containers)) {
          const ids = containers.map((item) => (item as { id: string }).id);
          const share = 1 / ids.length;
          const probabilities = Object.fromEntries(ids.map((id) => [id, share]));
          return Promise.resolve(reply({ where: choice(probabilities, ids[0] ?? 'C001') }));
        }
        if (call.questions['where']) {
          const ids = elementsOf(call).map((item) => item.id);
          const rest = ids.length > 1 ? 0.01 / (ids.length - 1) : 0;
          const probabilities = Object.fromEntries(
            ids.map((id, index) => [id, index === 0 ? 0.99 : rest]),
          );
          return Promise.resolve(reply({ where: choice(probabilities, ids[0] ?? 'E001') }));
        }
        const answers: Record<string, FindAnswer> = { exists: { type: 'noul', noul: 0.96 } };
        for (const key of Object.keys(call.questions)) {
          if (!key.startsWith('match_')) continue;
          const id = key.slice('match_'.length);
          answers[key] = { type: 'noul', noul: id === 'E202' ? 0.92 : 0.05 };
        }
        return Promise.resolve(reply(answers));
      },
    });
    expect(ranked.ok).toBe(true);
    if (!ranked.ok) return;
    expect(calls.some((call) => call.questions['match_E202']?.type === 'noul')).toBe(true);
    expect(ranked.value.matches[0]).toEqual({ target: 't-201', kind: 'shape', name: 'N201' });
    expect(ranked.value.matches.some((item) => item.target === 't-0')).toBe(false);
  });

  it('returns UPSTREAM_ERROR and does not call fetch when the API key is missing', async () => {
    const previous = process.env['TYPESAFE_API_KEY'];
    delete process.env['TYPESAFE_API_KEY'];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockClear();
    try {
      const ranked = await rankFind({
        query: 'title',
        candidates: [candidate(0)],
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(ranked.ok).toBe(false);
      if (ranked.ok) return;
      expect(ranked.error.code).toBe('UPSTREAM_ERROR');
      expect(ranked.error.hint).toContain('TYPESAFE_API_KEY');
    } finally {
      fetchSpy.mockRestore();
      if (previous === undefined) delete process.env['TYPESAFE_API_KEY'];
      else process.env['TYPESAFE_API_KEY'] = previous;
    }
  });
});

describe('find help', () => {
  it('documents find next to literal search', () => {
    expect(resolveHelp([])).toContain('find          Rank elements with a natural-language query');
    const topic = resolveHelp(['find']);
    expect(topic).toContain('usage: deckuse find <query>');
    expect(topic).toContain('TYPESAFE_API_KEY');
    expect(topic).toContain('api.typesafe.ai');
    expect(topic).toContain('data.matches');
  });
});

const CT = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml';

async function pptxFixture(path: string): Promise<void> {
  const archive = new OpcArchive();
  archive.setPart(
    '/[Content_Types].xml',
    encoder.encode(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/ppt/presentation.xml" ContentType="${CT}"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`,
    ),
    'application/xml',
  );
  archive.setPart(
    '/ppt/presentation.xml',
    encoder.encode(
      `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    ),
    CT,
  );
  archive.setRelationships('/ppt/presentation.xml', [
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
      target: 'slides/slide1.xml',
      external: false,
    },
  ]);
  archive.setPart(
    '/ppt/slides/slide1.xml',
    encoder.encode(
      `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name="Root"/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="5" name="Logo"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="10000000" y="200000"/><a:ext cx="1000000" cy="500000"/></a:xfrm></p:spPr></p:sp><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl><a:tblGrid><a:gridCol w="914400"/></a:tblGrid><a:tr h="370840"><a:tc><a:txBody><a:p><a:r><a:t>Cell</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/></p:nvGraphicFramePr><p:xfrm><a:off x="5000000" y="6000000"/><a:ext cx="1000000" cy="400000"/></p:xfrm><a:graphic><a:graphicData><c:chart r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
    ),
    'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  );
  archive.setRelationships('/ppt/slides/slide1.xml', [
    {
      id: 'rId2',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
      target: '../charts/chart1.xml',
      external: false,
    },
  ]);
  archive.setPart(
    '/ppt/charts/chart1.xml',
    encoder.encode(
      `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Sales</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:v>Series A</c:v></c:tx><c:val><c:numRef><c:numCache><c:pt><c:v>42</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`,
    ),
    'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  );
  await archive.writeFile(path);
}

describe('find adapters', () => {
  it('uses the same PPTX target as search and omits table cells', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-find-pptx-'));
    const source = join(root, 'in.pptx');
    const workspace = join(root, 'ws');
    await pptxFixture(source);
    const init = await pptxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'pptx', source },
      {},
    );
    expect(init.ok).toBe(true);

    const searched = await pptxAdapter.execute(
      { version: '2.0', type: 'search', workspaceId: workspace, kind: 'text', query: 'Hello' },
      {},
    );
    expect(searched.ok).toBe(true);
    if (!searched.ok) return;
    const title = (searched.value as { matches: { target: string; name?: string }[] }).matches.find(
      (item) => item.name === 'Title',
    );
    expect(title?.target).toBeTruthy();

    let sawChart = false;
    let sawLogo = false;
    injectFindClient((call) => {
      const rows = elementsOf(call);
      expect(rows.some((item) => item.kind === 'tableCell')).toBe(false);
      const chart = rows.find((item) => item.name === 'Chart');
      const logo = rows.find((item) => item.name === 'Logo');
      sawChart =
        (chart?.text?.includes('Sales') ?? false) && (chart?.text?.includes('Series A') ?? false);
      sawLogo = logo?.place === 'top-right' && logo.text === undefined;
      const probabilities = Object.fromEntries(
        rows.map((item) => [item.id, item.name === 'Title' ? 0.9 : 0]),
      );
      const winner = rows.find((item) => item.name === 'Title')?.id ?? 'E001';
      probabilities[winner] = 0.9;
      return Promise.resolve(
        reply({
          where: choice(probabilities, winner),
          exists: { type: 'noul', noul: 0.93 },
        }),
      );
    });

    const found = await pptxAdapter.execute(
      { version: '2.0', type: 'find', workspaceId: workspace, query: 'the title' },
      {},
    );
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(sawChart).toBe(true);
    expect(sawLogo).toBe(true);
    const foundMatches = (found.value as { matches: Record<string, unknown>[] }).matches;
    expect(Object.keys(found.value as object)).toEqual(['matches']);
    expect(foundMatches[0]).toEqual(title);
    expect(foundMatches[0]).not.toHaveProperty('score');

    injectFindClient(() => Promise.reject(new Error('should not call')));
    const missed = await pptxAdapter.execute(
      { version: '2.0', type: 'find', workspaceId: workspace, query: 'missing slide', slide: 9 },
      {},
    );
    expect(missed.ok).toBe(true);
    if (!missed.ok) return;
    expect(missed.value).toEqual({ matches: [] });
  });

  it('uses the same DOCX target as search and rejects slide', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deckuse-find-docx-'));
    const source = join(root, 'in.docx');
    const workspace = join(root, 'ws');
    const archive = buildBlankArchive();
    archive.setPart(
      '/word/document.xml',
      encoder.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="AAAA0001"><w:r><w:t>Hello</w:t></w:r></w:p>
    <w:p w14:paraId="AAAA0002"><w:r><w:t>Other</w:t></w:r></w:p>
  </w:body>
</w:document>`,
      ),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
    );
    await archive.writeFile(source);
    const init = await docxAdapter.init(
      { version: '2.0', type: 'init', workspaceId: workspace, format: 'docx', source },
      {},
    );
    expect(init.ok).toBe(true);

    const searched = await docxAdapter.execute(
      { version: '2.0', type: 'search', workspaceId: workspace, kind: 'text', query: 'Hello' },
      {},
    );
    expect(searched.ok).toBe(true);
    if (!searched.ok) return;
    const hello = (searched.value as { matches: { target: string; text?: string }[] }).matches[0];

    injectFindClient((call) => {
      const rows = elementsOf(call);
      const match = rows.find((item) => item.text === 'Hello');
      const probabilities = Object.fromEntries(
        rows.map((item) => [item.id, item.id === match?.id ? 0.88 : 0]),
      );
      return Promise.resolve(
        reply({
          where: choice(probabilities, match?.id ?? 'E001'),
          exists: { type: 'noul', noul: 0.9 },
        }),
      );
    });
    const found = await docxAdapter.execute(
      { version: '2.0', type: 'find', workspaceId: workspace, query: 'the greeting' },
      {},
    );
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect((found.value as { matches: { target: string }[] }).matches[0]).toEqual(hello);

    const rejected = await docxAdapter.execute(
      { version: '2.0', type: 'find', workspaceId: workspace, query: 'greeting', slide: 1 },
      {},
    );
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe('INVALID_COMMAND');
  });
});
