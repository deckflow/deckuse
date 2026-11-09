import { expect, it } from 'vitest';
import { parseXml } from '../../src/opc/index.js';
import { planTextReplacement } from '../../src/pptx/text-replacement.js';
import { NS, descendants } from '../../src/pptx/xml.js';

const shape = (body: string) =>
  parseXml(`<p:sp xmlns:p="${NS.p}" xmlns:a="${NS.a}"><p:txBody>${body}</p:txBody></p:sp>`)
    .documentElement;
const run = (text: string) => `<a:r><a:rPr b="1"/><a:t>${text}</a:t></a:r>`;

it('supports capture references across runs with equivalent formatting', () => {
  const node = shape(`<a:p>${run('Alpha Be')}${run('ta!')}</a:p>`);
  planTextReplacement(node, 'Alpha Beta!', /(?<word>Beta)/gu, '[$<word>]', true)();
  expect(descendants(node, 't').map((item) => item.textContent)).toEqual(['Alpha [Beta]', '!']);
  expect(descendants(node, 'rPr')).toHaveLength(2);
});

it.each([
  [`<a:p>${run('A')}<a:br/>${run('B')}</a:p>`, 'AB'],
  [`<a:p>${run('A')}</a:p><a:p>${run('B')}</a:p>`, 'AB'],
  [`<a:p>${run('A')}<a:fld id="field"><a:t>42</a:t></a:fld></a:p>`, 'A42'],
])('rejects replacements crossing protected text boundaries', (body, text) => {
  const node = shape(body);
  expect(() => planTextReplacement(node, text, new RegExp(text, 'gu'), 'X', false)).toThrow();
  expect(
    descendants(node, 't')
      .map((item) => item.textContent)
      .join(''),
  ).toBe(text);
});
