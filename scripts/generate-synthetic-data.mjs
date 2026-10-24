// Generates NON-CONFIDENTIAL synthetic Mach-1 files that mimic the real file
// layout (CRLF line endings, tab-separated, INFO/Wait/Move Relative/DATA blocks).
// The numbers are invented. Run with:  node scripts/generate-synthetic-data.mjs
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'examples', 'synthetic-data', 'Hydrogel Experiments');
const CAL = 1.0;
const STEP = 0.5 * CAL; // force resolution, gf
let seed = 12345;
function rand() {
  // mulberry32: deterministic so the examples never change between runs
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
const q = (f) => Math.round(f / STEP) * STEP;
const fmt = (v) => v.toFixed(6);
const pad = (n) => String(n).padStart(2, '0');

function info(clock) {
  const h = Math.floor(clock / 3600), m = Math.floor((clock % 3600) / 60), s = clock % 60;
  return [
    '<INFO>',
    'Date:\tMon, Jan 05, 2026',
    `Time:\t${pad(h)}:${pad(m)}:${s.toFixed(3).padStart(6, '0')}`,
    'Mach-1 Motion Software Version:\t4.5.0.1',
    'Mach-1 System S/N:\tDEMO0000',
    'Mach-1 System Model:\tDEMO',
    'Load Cell Name:\tDEMO-100N',
    'Load Cell Type:\tSingle-axis',
    `Load Cell Calibration Factor:\t${CAL.toFixed(6)}`,
    'Load Cell Offset:\t0.000000',
    'Load Cell Calibration Date:\t2026-01-05',
    'Load Cell Low-pass filter:\tYes',
    'Load Cell Low-pass filter Order:\t3',
    'Load Cell Low-pass filter Cutoff frequency (Hz):\t3.00',
    '<END INFO>',
  ];
}
const HEADER = 'Time, s\tPosition (z), mm\tPosition (x), mm\tPosition (y), mm\tFz, gf';
const row = (t, z, f) => `${fmt(t)}\t${fmt(z)}\t0.300000\t-0.080000\t${fmt(f)}`;

function holdBlock(clock, holdS, z, base) {
  const lines = [...info(clock), '<Wait>', `Wait:\t00:${pad(Math.floor(holdS / 60))}:${pad(holdS % 60)}`, '<DATA>', HEADER];
  const n = Math.round(holdS * 100) + 10;
  for (let i = 0; i < n; i++) lines.push(row(i / 100, z, q(base + 0.3 * gauss())));
  lines.push('<END DATA>');
  return lines;
}

function smoother(x) {
  const c = Math.min(1, Math.max(0, x));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

function moveBlock(clock, z0, base, peak, opts = {}) {
  const amp = -2.5;
  const lines = [...info(clock), '<Move Relative>', 'Stage Axis:\tPosition (z)', `Amplitude, mm:\t${amp.toFixed(4)}`, 'Velocity, mm/s:\t10.0000', '<DATA>', HEADER];
  const n = 110;
  for (let i = 0; i < n; i++) {
    const t = i / 100;
    const z = z0 + amp * smoother((t - 0.2) / 0.5);
    const u = (t - 0.2) / 0.22;
    const g = t > 0.2 ? u * u * Math.exp(2 * (1 - u)) : 0;
    let f = base * (t < 0.2 ? 1 : Math.max(0, 1 - u)) - peak * g + 0.25 * gauss();
    if (opts.spikeAt === i) f += opts.spikeSize;
    if (opts.positiveOnly) f = Math.max(base + 3 * g + 0.25 * gauss(), STEP); // probe never pulled on the gel
    lines.push(row(t, z, q(f)));
  }
  if (opts.malformedRow) lines.splice(lines.length - 20, 0, '0.9\t39.5\tN/A');
  if (!opts.truncate) lines.push('<END DATA>');
  return lines;
}

function makeFile({ holdS, cycles, peak, startClock, special = {} }) {
  const lines = ['<Mach-1 File>'];
  let clock = startClock;
  for (let c = 1; c <= cycles; c++) {
    const base = 1 + 0.5 * rand();
    const z0 = 42 - 0.004 * c;
    let p = peak * (1 + 0.06 * gauss());
    if (special.positiveOnlyCycle === c) p = -3; // missed contact: no adhesion
    if (special.weakCycle === c) p = peak * 0.12;
    lines.push(...holdBlock(clock, holdS, z0, base));
    clock += holdS + 0.1;
    const opts = {};
    if (special.positiveOnlyCycle === c) opts.positiveOnly = true;
    if (special.spikeCycle === c) Object.assign(opts, { spikeAt: 60, spikeSize: 18 });
    if (special.truncateLast && c === cycles) Object.assign(opts, { truncate: true, malformedRow: true });
    lines.push(...moveBlock(clock, z0, base, p, opts));
    clock += 36;
  }
  return lines.join('\r\n') + (special.truncateLast ? '' : '\r\n');
}

rmSync(OUT, { recursive: true, force: true });
const ratios = [
  { folder: '0.25 (2.5M)', base: 55 },
  { folder: '0.50', base: 42 },
  { folder: '0.75', base: 30 },
  { folder: '1.05', base: 18 },
];
const holds = [1, 5, 10];
let clock = 9 * 3600;
for (const r of ratios) {
  const substrates = r.folder === '0.50' ? ['Glass', 'PTFE'] : ['Glass'];
  for (const sub of substrates) {
    const dir = join(OUT, r.folder, sub);
    mkdirSync(dir, { recursive: true });
    for (const h of holds) {
      const peak = r.base * (sub === 'PTFE' ? 0.35 : 1) * (1 + 0.12 * Math.log10(h));
      const repeats = h === 5 ? 2 : 1;
      for (let rep = 1; rep <= repeats; rep++) {
        const special = {};
        if (r.folder.startsWith('0.25') && h === 1 && rep === 1) special.spikeCycle = 3;
        if (r.folder.startsWith('0.25') && h === 5 && rep === 2) special.positiveOnlyCycle = 2;
        if (r.folder === '0.75' && h === 10) special.weakCycle = 4;
        if (r.folder === '1.05' && h === 5 && rep === 2) special.truncateLast = true;
        const name = rep === 1 ? `${h}s.txt` : `${h}s-${rep}.txt`;
        writeFileSync(join(dir, name), makeFile({ holdS: h, cycles: 5, peak, startClock: clock, special }));
        clock += 600;
      }
    }
  }
}
// A file that contains only the header, like a measurement that never started.
writeFileSync(join(OUT, '0.25 (2.5M)', 'Glass', '1s-2.txt'), '<Mach-1 File>\r\n');
console.log('Synthetic examples written to', OUT);
