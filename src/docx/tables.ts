import type { Document, Element } from '@xmldom/xmldom';
import { ensureParaId } from './paragraphs.js';
import { wEl, writeTextNode } from './xml.js';

export const createTable = (doc: Document, rows: string[][]): Element => {
  const columns = Math.max(...rows.map((row) => row.length));
  const width = String(Math.max(1, Math.floor(9360 / columns)));
  const table = wEl(doc, 'tbl');
  const tblPr = wEl(doc, 'tblPr');
  const tblW = wEl(doc, 'tblW');
  tblW.setAttribute('w:w', '5000');
  tblW.setAttribute('w:type', 'pct');
  tblPr.appendChild(tblW);
  const borders = wEl(doc, 'tblBorders');
  for (const edge of ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']) {
    const line = wEl(doc, edge);
    line.setAttribute('w:val', 'single');
    line.setAttribute('w:sz', '4');
    line.setAttribute('w:space', '0');
    line.setAttribute('w:color', 'CCCCCC');
    borders.appendChild(line);
  }
  tblPr.appendChild(borders);
  table.appendChild(tblPr);
  const grid = wEl(doc, 'tblGrid');
  for (let index = 0; index < columns; index += 1) {
    const col = wEl(doc, 'gridCol');
    col.setAttribute('w:w', width);
    grid.appendChild(col);
  }
  table.appendChild(grid);
  for (const row of rows) {
    const tr = wEl(doc, 'tr');
    for (let index = 0; index < columns; index += 1) {
      const tc = wEl(doc, 'tc');
      const tcPr = wEl(doc, 'tcPr');
      const tcW = wEl(doc, 'tcW');
      tcW.setAttribute('w:w', width);
      tcW.setAttribute('w:type', 'dxa');
      tcPr.appendChild(tcW);
      tc.appendChild(tcPr);
      const paragraph = wEl(doc, 'p');
      const value = row[index] ?? '';
      if (value.length > 0) {
        const run = wEl(doc, 'r');
        const text = wEl(doc, 't');
        writeTextNode(text, value);
        run.appendChild(text);
        paragraph.appendChild(run);
      }
      ensureParaId(paragraph);
      tc.appendChild(paragraph);
      tr.appendChild(tc);
    }
    table.appendChild(tr);
  }
  return table;
};

export const tableRowsValid = (rows: string[][]): string | undefined => {
  if (rows.length === 0) return 'addTable requires at least one row';
  if (rows.some((row) => row.length === 0)) return 'addTable rows cannot be empty';
  return undefined;
};
