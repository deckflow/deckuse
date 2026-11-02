import { describe, expect, it } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { updateChart } from '../../src/pptx/elements.js';
const make = (ref: boolean) => {
  const archive = new OpcArchive();
  const cache = '<c:ptCount val="1"/><c:pt idx="0"><c:v>42</c:v></c:pt>';
  archive.setPart(
    '/ppt/charts/chart1.xml',
    new TextEncoder().encode(
      `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:tx><c:v>A</c:v></c:tx><c:val>${ref ? '<c:numRef><c:f>Sheet1!$A$1</c:f><c:numCache>' + cache + '</c:numCache></c:numRef>' : '<c:numLit>' + cache + '</c:numLit>'}</c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`,
    ),
  );
  return archive;
};
describe('chart data guard', () => {
  it('refuses referenced cache writes without changing bytes', async () => {
    const archive = make(true);
    const before = archive.getPart('/ppt/charts/chart1.xml')!.data.slice();
    await expect(
      updateChart(archive, '/ppt/charts/chart1.xml', { series: [{ values: [99] }] }),
    ).rejects.toThrow('workbook');
    expect(archive.getPart('/ppt/charts/chart1.xml')!.data).toEqual(before);
  });
  it('allows literal values but rejects invalid values and indexes', async () => {
    const archive = make(false);
    expect(
      await updateChart(archive, '/ppt/charts/chart1.xml', { series: [{ values: [99] }] }),
    ).toMatchObject({ workbook: false, changes: [] });
    await expect(
      updateChart(archive, '/ppt/charts/chart1.xml', { series: [{ values: [NaN] }] }),
    ).rejects.toThrow('finite');
    await expect(
      updateChart(archive, '/ppt/charts/chart1.xml', { series: [{}, {}] }),
    ).rejects.toThrow('index');
  });
});
