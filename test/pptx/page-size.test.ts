import { describe, it, expect } from 'vitest';
import { OpcArchive } from '../../src/opc/index.js';
import { readSlideSize, setBlankPageSize } from '../../src/pptx/slide-size.js';
import { assertDefaultPptxExists } from '../../src/default-template.js';

describe('blank page size', () => {
  it.each([
    ['8.5in', '11in', 7772400, 10058400],
    ['10in', '7.5in', 9144000, 6858000],
  ])('writes native dimensions %s × %s', async (width, height, widthEmu, heightEmu) => {
    const archive = await OpcArchive.openFile(await assertDefaultPptxExists());
    setBlankPageSize(archive, { width, height });
    expect(readSlideSize(archive)).toEqual({ widthEmu, heightEmu });
    const reopened = await OpcArchive.open(await archive.toUint8Array());
    expect(readSlideSize(reopened)).toEqual({ widthEmu, heightEmu });
  });
  it.each(['0', '-1in', '100%', '57in', 'NaN'])(
    'rejects %s without changing XML',
    async (width) => {
      const archive = await OpcArchive.openFile(await assertDefaultPptxExists());
      const before = archive.getPart('/ppt/presentation.xml')!.data.slice();
      expect(() => setBlankPageSize(archive, { width, height: '10in' })).toThrow();
      expect(archive.getPart('/ppt/presentation.xml')!.data).toEqual(before);
    },
  );
});
