/**
 * Parser for Biomomentum Mach-1 Motion TXT exports.
 *
 * Observed structure (Mach-1 Motion 4.5.0.1):
 *
 *   <Mach-1 File>
 *   <INFO>            key:\tvalue lines (date, time, system, load cell, filter)
 *   <END INFO>
 *   <Wait>            operation tag
 *   Wait:\t00:01:00   operation parameters
 *   <DATA>
 *   Time, s\tPosition (z), mm\t...\tFz, gf      tab-separated header
 *   0.000000\t42.011989\t...                     tab-separated numbers
 *   <END DATA>
 *   <INFO> ... <Move Relative> ... <DATA> ... <END DATA>    (repeats)
 *
 * Every operation carries its own INFO block with its start time.
 * The parser never alters values; malformed rows are counted and reported.
 */
import type { Cycle, DataTable, OperationBlock, ParsedFile, ParseIssue } from '../types';
import { GF_TO_N } from '../types';

const KNOWN_STRUCTURAL = new Set(['MACH-1 FILE', 'INFO', 'END INFO', 'DATA', 'END DATA']);
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** FNV-1a 32-bit hash as 8 hex chars (used only for short, stable ids). */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function makeFileId(path: string, sha256: string): string {
  return `${sha256.slice(0, 10)}-${fnv1a(path)}`;
}

function splitKeyValue(line: string): [string, string] | null {
  const tabColon = line.indexOf(':\t');
  if (tabColon >= 0) return [line.slice(0, tabColon).trim(), line.slice(tabColon + 2).trim()];
  const tab = line.indexOf('\t');
  if (tab >= 0) return [line.slice(0, tab).replace(/:$/, '').trim(), line.slice(tab + 1).trim()];
  const colon = line.indexOf(':');
  if (colon >= 0) return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
  return null;
}

function splitHeader(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((s) => s.trim()).filter((s) => s.length > 0);
  // Fallback for re-saved files that use runs of spaces. Single spaces are kept
  // because header names such as "Time, s" contain them.
  return line.split(/\s{2,}/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function splitRow(line: string): string[] {
  return line.trim().split(/[\t ]+/);
}

/** Parse "Wed, Oct 21, 2026" + "16:28:11.687" into "2026-10-21T16:28:11.687". */
export function toTimestamp(date: string | undefined, time: string | undefined): string | null {
  if (!date) return null;
  const m = date.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  let ymd: string | null = null;
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon) ymd = `${m[3]}-${mon}-${m[2].padStart(2, '0')}`;
  } else {
    const iso = date.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) ymd = `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  if (!ymd) return null;
  const t = time?.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  return t ? `${ymd}T${t[1].padStart(2, '0')}:${t[2]}:${t[3].padStart(2, '0')}` : ymd;
}

/** "00:01:00" -> 60, "00:00:01.5" -> 1.5, "30" -> 30. */
export function parseDuration(text: string | undefined): number | null {
  if (!text) return null;
  const s = text.trim();
  const hms = s.match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  const ms = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (ms) return Number(ms[1]) * 60 + Number(ms[2]);
  const n = Number(s.replace(/[^\d.eE+-]/g, ''));
  return Number.isFinite(n) && s.length > 0 ? n : null;
}

function parseNumberParam(params: Record<string, string>, pattern: RegExp): number | null {
  for (const [k, v] of Object.entries(params)) {
    if (pattern.test(k)) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

interface RawTable {
  header: string[];
  rows: number[][];
  malformed: number;
  malformedLines: number[];
}

function finishTable(raw: RawTable): DataTable {
  const ncol = raw.header.length;
  const values: Float64Array[] = [];
  for (let c = 0; c < ncol; c++) {
    const col = new Float64Array(raw.rows.length);
    for (let r = 0; r < raw.rows.length; r++) col[r] = raw.rows[r][c];
    values.push(col);
  }
  return { columns: raw.header, values, rowCount: raw.rows.length, malformedRows: raw.malformed };
}

export function parseMach1Text(text: string, path: string, sha256: string, sizeBytes: number): ParsedFile {
  const name = path.split('/').pop() ?? path;
  const issues: ParseIssue[] = [];
  const unrecognized = new Set<string>();
  const blocks: OperationBlock[] = [];
  let header: Record<string, string> = {};

  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);

  if (firstNonEmpty < 0) {
    issues.push({ severity: 'error', message: 'The file is empty.' });
  } else if (lines[firstNonEmpty].trim().toUpperCase() !== '<MACH-1 FILE>') {
    issues.push({
      severity: 'warning',
      message: 'The file does not start with the <Mach-1 File> tag; parsing it anyway.',
      line: firstNonEmpty + 1,
    });
  }

  let mode: 'none' | 'info' | 'params' | 'dataHeader' | 'data' = 'none';
  let pendingInfo: Record<string, string> = {};
  let current: OperationBlock | null = null;
  let table: RawTable | null = null;
  let dataStartLine = 0;

  const closeTable = (endedProperly: boolean, lineNo: number) => {
    if (!current || !table) return;
    current.data = finishTable(table);
    if (table.malformed > 0) {
      const shown = table.malformedLines.slice(0, 5).join(', ');
      issues.push({
        severity: 'warning',
        message: `${current.type} block ${current.index + 1}: ${table.malformed} malformed row(s) were not used (lines ${shown}${table.malformed > 5 ? ', …' : ''}).`,
        line: table.malformedLines[0],
      });
    }
    if (!endedProperly) {
      issues.push({
        severity: 'warning',
        message: `${current.type} block ${current.index + 1}: data section has no <END DATA> tag (file may be truncated).`,
        line: lineNo,
      });
    }
    table = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    const lineNo = i + 1;
    if (line.length === 0) continue;

    const tag = line.match(/^<([^<>]+)>$/);
    if (tag) {
      const tagName = tag[1].trim();
      const upper = tagName.toUpperCase();
      if (mode === 'data' || mode === 'dataHeader') {
        if (upper !== 'END DATA') closeTable(false, lineNo);
        else {
          closeTable(true, lineNo);
          mode = 'none';
          continue;
        }
      }
      if (upper === 'MACH-1 FILE') continue;
      if (upper === 'INFO') {
        mode = 'info';
        pendingInfo = {};
        continue;
      }
      if (upper === 'END INFO') {
        if (Object.keys(header).length === 0) header = { ...pendingInfo };
        mode = 'none';
        continue;
      }
      if (upper === 'DATA') {
        if (!current) {
          current = { index: blocks.length, type: '(no operation tag)', info: pendingInfo, params: {}, data: null, startLine: lineNo };
          blocks.push(current);
          issues.push({ severity: 'warning', message: 'A <DATA> section appeared without an operation tag.', line: lineNo });
        }
        mode = 'dataHeader';
        dataStartLine = lineNo;
        continue;
      }
      if (upper === 'END DATA') {
        mode = 'none';
        continue;
      }
      if (upper.startsWith('END ')) {
        if (!KNOWN_STRUCTURAL.has(upper)) unrecognized.add(tagName);
        mode = 'none';
        continue;
      }
      // Any other tag starts an operation block (Wait, Move Relative, ...).
      current = { index: blocks.length, type: tagName, info: pendingInfo, params: {}, data: null, startLine: lineNo };
      pendingInfo = {};
      blocks.push(current);
      if (!/^(wait|move)/i.test(tagName)) unrecognized.add(tagName);
      mode = 'params';
      continue;
    }

    switch (mode) {
      case 'info': {
        const kv = splitKeyValue(raw);
        if (kv) pendingInfo[kv[0]] = kv[1];
        break;
      }
      case 'params': {
        const kv = splitKeyValue(raw);
        if (kv && current) current.params[kv[0]] = kv[1];
        break;
      }
      case 'dataHeader': {
        table = { header: splitHeader(raw), rows: [], malformed: 0, malformedLines: [] };
        mode = 'data';
        break;
      }
      case 'data': {
        if (!table) break;
        const parts = splitRow(raw);
        const t: RawTable = table;
        if (parts.length !== t.header.length) {
          t.malformed++;
          t.malformedLines.push(lineNo);
          break;
        }
        const row = new Array<number>(parts.length);
        let ok = true;
        for (let c = 0; c < parts.length; c++) {
          const v = Number(parts[c]);
          if (!Number.isFinite(v)) {
            ok = false;
            break;
          }
          row[c] = v;
        }
        if (ok) t.rows.push(row);
        else {
          t.malformed++;
          t.malformedLines.push(lineNo);
        }
        break;
      }
      default:
        if (line.length > 0) {
          issues.push({ severity: 'info', message: `Unexpected text outside any section was ignored: "${line.slice(0, 60)}"`, line: lineNo });
        }
    }
  }
  if (mode === 'data' || mode === 'dataHeader') closeTable(false, dataStartLine);

  for (const b of blocks) {
    if (!b.data || b.data.rowCount === 0) {
      issues.push({ severity: 'warning', message: `${b.type} block ${b.index + 1} has no measurement rows.`, line: b.startLine });
    }
  }
  if (unrecognized.size > 0) {
    issues.push({
      severity: 'info',
      message: `Unrecognized section(s) kept but not analysed as movement cycles: ${[...unrecognized].join(', ')}.`,
    });
  }
  const totalRows = blocks.reduce((s, b) => s + (b.data?.rowCount ?? 0), 0);
  if (firstNonEmpty >= 0 && totalRows === 0) {
    issues.push({
      severity: 'error',
      message:
        blocks.length === 0
          ? 'No measurement data: the file contains only the Mach-1 header (no operations or data). No force values were calculated.'
          : 'No usable measurement rows were found. No force values were calculated.',
    });
  }
  if (blocks.length > 0 && !blocks.some((b) => /^move/i.test(b.type))) {
    issues.push({ severity: 'warning', message: 'No movement (Move) operations were found, so there are no cycles to analyse.' });
  }

  const status = issues.some((x) => x.severity === 'error')
    ? 'error'
    : issues.some((x) => x.severity === 'warning')
      ? 'warning'
      : 'ok';

  return {
    fileId: makeFileId(path, sha256),
    path,
    name,
    sha256,
    sizeBytes,
    header,
    blocks,
    issues,
    unrecognizedSections: [...unrecognized],
    status,
  };
}

function findColumn(columns: string[], pattern: RegExp): number {
  return columns.findIndex((c) => pattern.test(c));
}

/**
 * Build movement cycles. A cycle is one Move block; it is paired with the
 * immediately preceding Wait block (the holding period) when there is one.
 */
export function extractCycles(file: ParsedFile): Cycle[] {
  const cycles: Cycle[] = [];
  let moveCount = 0;
  for (const block of file.blocks) {
    if (!/^move/i.test(block.type)) continue;
    moveCount++;
    const issues: ParseIssue[] = [];
    const data = block.data;
    const prev = block.index > 0 ? file.blocks[block.index - 1] : null;
    const hold = prev && /^wait/i.test(prev.type) ? prev : null;
    if (!hold) issues.push({ severity: 'info', message: 'No Wait (holding) block precedes this movement.' });

    const cycleId = `${file.fileId}#c${moveCount}`;
    const empty = new Float64Array(0);
    let time_s: Float64Array<ArrayBufferLike> = empty;
    let z_mm: Float64Array<ArrayBufferLike> = empty;
    let force_gf: Float64Array<ArrayBufferLike> = empty;
    const extra: Record<string, Float64Array> = {};

    if (!data || data.rowCount === 0) {
      issues.push({ severity: 'error', message: 'Movement has no measurement rows.' });
    } else {
      const it = findColumn(data.columns, /^time/i);
      const iz = findColumn(data.columns, /position\s*\(z\)/i);
      let iforce = findColumn(data.columns, /^fz\b/i);
      if (iforce < 0) iforce = findColumn(data.columns, /force|^f[xyz]?\s*,/i);
      if (it < 0) issues.push({ severity: 'error', message: 'Time column not found.' });
      if (iz < 0) issues.push({ severity: 'warning', message: 'Position (z) column not found; displacement is unavailable.' });
      if (iforce < 0) issues.push({ severity: 'error', message: 'Force column (Fz) not found.' });
      if (it >= 0) time_s = data.values[it];
      if (iz >= 0) z_mm = data.values[iz];
      if (iforce >= 0) {
        const unit = data.columns[iforce].split(',')[1]?.trim().toLowerCase() ?? 'gf';
        if (unit === 'n') {
          force_gf = data.values[iforce].map((v) => v / GF_TO_N);
          issues.push({ severity: 'info', message: 'Force was recorded in N and converted to gf for analysis.' });
        } else if (unit === 'kgf') {
          force_gf = data.values[iforce].map((v) => v * 1000);
        } else if (unit === 'mn') {
          force_gf = data.values[iforce].map((v) => v / 1000 / GF_TO_N);
        } else {
          force_gf = data.values[iforce];
          if (unit !== 'gf') issues.push({ severity: 'warning', message: `Unrecognized force unit "${unit}"; values are treated as gf.` });
        }
      }
      data.columns.forEach((c, i) => {
        if (i !== it && i !== iz && i !== iforce) extra[c] = data.values[i];
      });
      if (data.rowCount < 5) issues.push({ severity: 'warning', message: `Only ${data.rowCount} data points recorded.` });
    }

    let holdTime_s: Float64Array | null = null;
    let holdForce_gf: Float64Array | null = null;
    if (hold?.data && hold.data.rowCount > 0) {
      const it = findColumn(hold.data.columns, /^time/i);
      let iforce = findColumn(hold.data.columns, /^fz\b/i);
      if (iforce < 0) iforce = findColumn(hold.data.columns, /force/i);
      if (it >= 0) holdTime_s = hold.data.values[it];
      if (iforce >= 0) holdForce_gf = hold.data.values[iforce];
    }

    const date = block.info['Date'] ?? file.header['Date'] ?? null;
    const time = block.info['Time'] ?? null;
    cycles.push({
      cycleId,
      fileId: file.fileId,
      cycleNumber: moveCount,
      moveBlockIndex: block.index,
      holdBlockIndex: hold ? hold.index : null,
      operation: block.type,
      holdTimeS: hold ? parseDuration(hold.params['Wait'] ?? Object.values(hold.params)[0]) : null,
      amplitudeMm: parseNumberParam(block.params, /amplitude/i),
      velocityMmS: parseNumberParam(block.params, /velocity/i),
      stageAxis: block.params['Stage Axis'] ?? null,
      date,
      time,
      timestamp: toTimestamp(date ?? undefined, time ?? undefined),
      time_s,
      z_mm,
      force_gf,
      extra,
      holdTime_s,
      holdForce_gf,
      issues,
    });
  }
  return cycles;
}
