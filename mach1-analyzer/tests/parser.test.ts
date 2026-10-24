import { describe, expect, it } from 'vitest';
import { extractCycles, parseDuration, parseMach1Text, toTimestamp } from '../src/parser/mach1Parser';
import { parseSource, expandZip } from '../src/parser/loader';
import { sha256Fallback, sha256Hex } from '../src/parser/hash';
import { enc, miniFile } from './helpers';
import { zipSync } from 'fflate';

const parse = (text: string, path = '0.25/Glass/30s.txt') => parseMach1Text(text, path, 'abc123', text.length);

describe('Mach-1 parser', () => {
  it('extracts metadata from the first INFO block', () => {
    const f = parse(miniFile([[0, -10, -40, -5, 0]]));
    expect(f.header['Date']).toBe('Wed, Oct 21, 2026');
    expect(f.header['Time']).toBe('16:28:11.687');
    expect(f.header['Load Cell Low-pass filter']).toBe('Yes');
    expect(f.status).toBe('ok');
  });

  it('separates Wait and Move Relative blocks and pairs each move with its hold', () => {
    const f = parse(miniFile([[0, -40, 0], [0, -38, 0], [0, -2, 0]]));
    expect(f.blocks.map((b) => b.type)).toEqual(['Wait', 'Move Relative', 'Wait', 'Move Relative', 'Wait', 'Move Relative']);
    const cycles = extractCycles(f);
    expect(cycles).toHaveLength(3);
    expect(cycles.map((c) => c.cycleNumber)).toEqual([1, 2, 3]);
    expect(cycles[1].holdTimeS).toBe(30);
    expect(cycles[1].amplitudeMm).toBe(-2.5);
    expect(cycles[1].velocityMmS).toBe(10);
    expect(cycles[1].holdForce_gf?.length).toBe(5);
    expect(cycles[2].force_gf[1]).toBe(-2);
    expect(cycles[0].cycleId).not.toBe(cycles[1].cycleId);
  });

  it('handles LF-only line endings identically', () => {
    const a = extractCycles(parse(miniFile([[0, -40, 0]], { crlf: true })));
    const b = extractCycles(parse(miniFile([[0, -40, 0]], { crlf: false })));
    expect(Array.from(a[0].force_gf)).toEqual(Array.from(b[0].force_gf));
  });

  it('reports an empty file as an error instead of producing zero forces', () => {
    const f = parse('');
    expect(f.status).toBe('error');
    expect(extractCycles(f)).toHaveLength(0);
  });

  it('reports a header-only file (like 1s-2.txt) as having no measurement data', () => {
    const f = parse('<Mach-1 File>\r\n');
    expect(f.status).toBe('error');
    expect(f.issues.some((i) => /only the Mach-1 header/.test(i.message))).toBe(true);
    expect(extractCycles(f)).toHaveLength(0);
  });

  it('reports malformed rows and a missing <END DATA> without discarding silently', () => {
    const text = miniFile([[0, -40, 0]]).replace(/<END DATA>\r\n$/, '').replace(/(0\.020000\t[^\r]*\r\n)(?![\s\S]*0\.020000)/, '$1garbage\t1\t2\r\n');
    const f = parse(text);
    expect(f.status).toBe('warning');
    expect(f.issues.some((i) => /malformed row/.test(i.message))).toBe(true);
    expect(f.issues.some((i) => /no <END DATA>/.test(i.message))).toBe(true);
  });

  it('parses scientific notation values', () => {
    const text = miniFile([[0, -40, 0]]).replace(/\t0\.3\t/g, '\t4.940656E-324\t');
    const c = extractCycles(parse(text))[0];
    expect(c.extra['Position (x), mm'][0]).toBeCloseTo(4.940656e-324);
    expect(c.force_gf[1]).toBe(-40);
  });

  it('keeps unknown operation sections and reports them', () => {
    const text = miniFile([[0, -40, 0]]).replace('<Wait>', '<Find Contact>');
    const f = parse(text);
    expect(f.unrecognizedSections).toContain('Find Contact');
    expect(f.blocks.some((b) => b.type === 'Find Contact')).toBe(true);
  });

  it('converts a force column recorded in N to gf for analysis', () => {
    const c = extractCycles(parse(miniFile([[0, -0.0980665, 0]], { forceHeader: 'Fz, N' })))[0];
    expect(c.force_gf[1]).toBeCloseTo(-10, 3);
  });

  it('parses durations and timestamps', () => {
    expect(parseDuration('00:01:00')).toBe(60);
    expect(parseDuration('00:00:01')).toBe(1);
    expect(parseDuration('00:00:30')).toBe(30);
    expect(parseDuration('01:30')).toBe(90);
    expect(toTimestamp('Wed, Oct 21, 2026', '16:58:05.387')).toBe('2026-10-21T16:58:05.387');
    expect(toTimestamp('Thu, Oct 22, 2026', '9:56:09.320')).toBe('2026-10-22T09:56:09.320');
  });

  it('computes the same SHA-256 with Web Crypto and the fallback', async () => {
    const bytes = enc('Mach-1 test bytes');
    expect(sha256Fallback(bytes)).toBe(await sha256Hex(bytes));
    expect(sha256Fallback(enc(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('gives different ids to identical files at different paths and the same id for the same path+content', async () => {
    const bytes = enc(miniFile([[0, -40, 0]]));
    const a = await parseSource({ path: '0.25/Glass/30s.txt', bytes });
    const b = await parseSource({ path: '0.50/Glass/30s.txt', bytes });
    const c = await parseSource({ path: '0.25/Glass/30s.txt', bytes });
    expect(a.parsed.fileId).not.toBe(b.parsed.fileId);
    expect(a.parsed.fileId).toBe(c.parsed.fileId);
  });

  it('expands ZIP archives, preserving folders and skipping macOS metadata', () => {
    const zip = zipSync({
      'Exp/0.25/Glass/30s.txt': enc(miniFile([[0, -40, 0]])),
      '__MACOSX/Exp/0.25/Glass/._30s.txt': enc('x'),
      'Exp/notes.docx': enc('x'),
    });
    const { files, skipped } = expandZip('Exp.zip', zip);
    expect(files.map((f) => f.path)).toEqual(['Exp/0.25/Glass/30s.txt']);
    expect(skipped.map((s) => s.path)).toEqual(['Exp.zip/Exp/notes.docx']);
  });
});
