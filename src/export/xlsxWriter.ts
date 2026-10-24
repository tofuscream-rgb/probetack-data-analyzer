/**
 * Minimal, dependency-light XLSX (Office Open XML) writer that runs in the browser.
 *
 * Why a custom writer: the open-source editions of SheetJS and ExcelJS can
 * write cells but cannot create native Excel charts. This writer produces the
 * SpreadsheetML parts directly (zipped with fflate), including DrawingML
 * scatter charts whose series reference worksheet cells, so the charts stay
 * editable in Excel. Cached values are embedded so viewers that do not
 * recalculate (Quick Look, some web previews) still show the curves.
 */
import { zipSync, strToU8 } from 'fflate';

export type CellValue = string | number | boolean | null | undefined;

export interface ChartSeriesSpec {
  name: string;
  nameCell?: string; // e.g. "A1" on the chart data sheet
  xRange: [string, string]; // e.g. ["B3", "B120"]
  yRange: [string, string];
  xValues: (number | null)[];
  yValues: (number | null)[];
}

export interface ChartSpec {
  title: string;
  xTitle: string;
  yTitle: string;
  series: ChartSeriesSpec[];
  /** Top-left anchor cell (0-based col,row) and size in cells. */
  from: { col: number; row: number };
  to: { col: number; row: number };
}

export interface SheetSpec {
  name: string;
  rows: CellValue[][];
  headerRows?: number; // bold + frozen
  colWidths?: number[];
  charts?: ChartSpec[];
}

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Remove characters that are illegal in XML 1.0
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function cellRef(col: number, row: number): string {
  return `${colName(col)}${row + 1}`;
}

export function absRef(sheet: string, ref: string): string {
  const m = ref.match(/^([A-Z]+)(\d+)$/)!;
  return `'${sheet.replace(/'/g, "''")}'!$${m[1]}$${m[2]}`;
}

/** Excel sheet names: ≤31 chars, no []:*?/\ */
export function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Sheet';
  let candidate = base;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  base = candidate;
  return base;
}

function sheetXml(sheet: SheetSpec, hasDrawing: boolean): string {
  const parts: string[] = [];
  parts.push(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
  );
  const header = sheet.headerRows ?? 0;
  if (header > 0) {
    parts.push(
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${header}" topLeftCell="A${header + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`,
    );
  }
  if (sheet.colWidths?.length) {
    parts.push('<cols>');
    sheet.colWidths.forEach((w, i) => parts.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`));
    parts.push('</cols>');
  }
  parts.push('<sheetData>');
  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    if (!row || row.length === 0) continue;
    const style = r < header ? ' s="1"' : '';
    let cells = '';
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v === null || v === undefined || v === '') continue;
      const ref = cellRef(c, r);
      if (typeof v === 'number') {
        if (Number.isFinite(v)) cells += `<c r="${ref}"${style}><v>${v}</v></c>`;
      } else if (typeof v === 'boolean') {
        cells += `<c r="${ref}" t="b"${style}><v>${v ? 1 : 0}</v></c>`;
      } else {
        cells += `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }
    }
    parts.push(`<row r="${r + 1}">${cells}</row>`);
  }
  parts.push('</sheetData>');
  if (hasDrawing) parts.push('<drawing r:id="rId1"/>');
  parts.push('</worksheet>');
  return parts.join('');
}

function numCache(values: (number | null)[]): string {
  const pts = values
    .map((v, i) => (v === null || !Number.isFinite(v) ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`))
    .join('');
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${pts}</c:numCache>`;
}

const PALETTE = ['1F4E9C', 'C4421A', '1B8A5A', '8E44AD', 'B7950B', '17A2B8', 'D35400', '34495E', 'E84393', '6C5B7B'];

function axisXml(id: number, cross: number, pos: 'b' | 'l', title: string): string {
  return `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>
<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>
<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1000" b="0"/></a:pPr><a:r><a:rPr lang="en-US" sz="1000" b="0"/><a:t>${esc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>
<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`;
}

function chartXml(chart: ChartSpec, sheetName: string): string {
  const series = chart.series
    .map((s, i) => {
      const color = PALETTE[i % PALETTE.length];
      const tx = s.nameCell
        ? `<c:tx><c:strRef><c:f>${esc(absRef(sheetName, s.nameCell))}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(s.name)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`
        : `<c:tx><c:v>${esc(s.name)}</c:v></c:tx>`;
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx}
<c:spPr><a:ln w="15875" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr>
<c:marker><c:symbol val="none"/></c:marker>
<c:xVal><c:numRef><c:f>${esc(absRef(sheetName, s.xRange[0]))}:${esc(absRef(sheetName, s.xRange[1]).split('!')[1])}</c:f>${numCache(s.xValues)}</c:numRef></c:xVal>
<c:yVal><c:numRef><c:f>${esc(absRef(sheetName, s.yRange[0]))}:${esc(absRef(sheetName, s.yRange[1]).split('!')[1])}</c:f>${numCache(s.yValues)}</c:numRef></c:yVal>
<c:smooth val="0"/></c:ser>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/>
<c:chart>
<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>${esc(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/>
<c:plotArea><c:layout/>
<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>
${series}
<c:axId val="500001"/><c:axId val="500002"/></c:scatterChart>
${axisXml(500001, 500002, 'b', chart.xTitle)}
${axisXml(500002, 500001, 'l', chart.yTitle)}
</c:plotArea>
<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>
<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>
</c:chart>
</c:chartSpace>`;
}

function drawingXml(charts: ChartSpec[], firstChartRel: number): string {
  const anchors = charts
    .map(
      (ch, i) => `<xdr:twoCellAnchor editAs="oneCell">
<xdr:from><xdr:col>${ch.from.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.from.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
<xdr:to><xdr:col>${ch.to.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.to.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${firstChartRel + i}"/></a:graphicData></a:graphic>
</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${anchors}
</xdr:wsDr>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function buildXlsx(sheets: SheetSpec[], meta: { title: string; creator: string }): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const ct: string[] = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
  ];
  const wbSheets: string[] = [];
  const wbRels: string[] = [];
  let chartNo = 0;
  let drawingNo = 0;

  sheets.forEach((sheet, i) => {
    const n = i + 1;
    const hasCharts = !!sheet.charts && sheet.charts.length > 0;
    files[`xl/worksheets/sheet${n}.xml`] = strToU8(sheetXml(sheet, hasCharts));
    ct.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    wbSheets.push(`<sheet name="${esc(sheet.name)}" sheetId="${n}" r:id="rId${n}"/>`);
    wbRels.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`);
    if (hasCharts) {
      drawingNo++;
      const d = drawingNo;
      files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${d}.xml"/></Relationships>`,
      );
      files[`xl/drawings/drawing${d}.xml`] = strToU8(drawingXml(sheet.charts!, 1));
      ct.push(`<Override PartName="/xl/drawings/drawing${d}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      const rels: string[] = [];
      sheet.charts!.forEach((ch, k) => {
        chartNo++;
        files[`xl/charts/chart${chartNo}.xml`] = strToU8(chartXml(ch, sheet.name));
        ct.push(`<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
        rels.push(`<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNo}.xml"/>`);
      });
      files[`xl/drawings/_rels/drawing${d}.xml.rels`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
      );
    }
  });
  const nSheets = sheets.length;
  wbRels.push(`<Relationship Id="rId${nSheets + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);

  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${ct.join('')}</Types>`,
  );
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files['docProps/core.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title)}</dc:title><dc:creator>${esc(meta.creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`,
  );
  files['docProps/app.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${esc(meta.creator)}</Application></Properties>`,
  );
  files['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${wbSheets.join('')}</sheets></workbook>`,
  );
  files['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels.join('')}</Relationships>`,
  );
  files['xl/styles.xml'] = strToU8(STYLES);
  return zipSync(files, { level: 6 });
}
