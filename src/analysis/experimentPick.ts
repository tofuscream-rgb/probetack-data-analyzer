/**
 * "Choose your experiment" dropdowns, shared by every test: charge ratio, then
 * concentration, substrate, gel and dwell (holding) time. Each list only offers the
 * values measured with the choices above it, and each can also be "all" (null).
 * Values come from the folder and file names (RunCondition).
 */
import type { ExperimentPick } from '../types';
import type { RunCondition } from './runCompare';
import { bySubstrate } from './substrates';

export interface PickOption {
  value: string;
  label: string;
  /** Files and runs with this value (given the choices above it). */
  files: number;
  runs: number;
}

/** One run's conditions; fileId lets the dropdowns count files as well as runs. */
export type PickItem = RunCondition & { fileId?: string };

/** Substrates or gels that differ only in capitals or spaces ("ss", "SS ") are the same. */
export const substrateKey = (s: string) => s.trim().toLowerCase();
const gelKey = (g: string | undefined) => (g === undefined || g === '—' || !g.trim() ? '—' : g.trim().toLowerCase());

export const PICK_LEVELS = ['chargeRatio', 'concentration', 'substrate', 'gel', 'hold'] as const;
export type PickLevel = (typeof PICK_LEVELS)[number];

export function pickValue(c: PickItem, k: PickLevel): string {
  switch (k) {
    case 'substrate': return substrateKey(c.substrate) || '—';
    case 'gel': return gelKey(c.gel);
    default: return c[k];
  }
}

export function matchesPick(c: PickItem, p: ExperimentPick): boolean {
  return PICK_LEVELS.every((k) => p[k] === null || p[k] === undefined || pickValue(c, k) === p[k]);
}

/** Numbers in numeric order (2 before 10), then text, then "unknown" last. */
export const numericFirst = (a: string, b: string) => {
  if (a === '—' || b === '—') return a === b ? 0 : a === '—' ? 1 : -1;
  const x = Number(a);
  const y = Number(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  if (Number.isFinite(x)) return -1;
  if (Number.isFinite(y)) return 1;
  return a.localeCompare(b, undefined, { numeric: true });
};

function optionsFor(list: PickItem[], k: PickLevel): PickOption[] {
  const byValue = new Map<string, PickItem[]>();
  for (const c of list) {
    const v = pickValue(c, k);
    byValue.set(v, [...(byValue.get(v) ?? []), c]);
  }
  const labelOf = (v: string, items: PickItem[]) => {
    if (v === '—') return k === 'gel' ? 'unspecified' : 'unknown';
    if (k === 'concentration') return `${v} M${items.every((c) => c.concentrationDefault) ? ' (assumed)' : ''}`;
    if (k === 'hold') return `${v} s`;
    if (k === 'substrate') return items[0].substrate.trim();
    if (k === 'gel') return items[0].gel!.trim();
    return v;
  };
  const opts = [...byValue].map(([value, items]) => ({
    value,
    label: labelOf(value, items),
    files: new Set(items.map((c, i) => c.fileId ?? `#${i}`)).size,
    runs: items.length,
  }));
  return k === 'substrate'
    ? opts.sort((a, b) => (a.value === '—' ? 1 : b.value === '—' ? -1 : bySubstrate(a.label, b.label)))
    : opts.sort((a, b) => numericFirst(a.value, b.value));
}

export interface PickOptions {
  chargeRatios: PickOption[];
  concentrations: PickOption[];
  substrates: PickOption[];
  gels: PickOption[];
  holds: PickOption[];
}

export function pickOptions(conds: PickItem[], p: ExperimentPick): PickOptions {
  const out: PickOption[][] = [];
  let list = conds;
  for (const k of PICK_LEVELS) {
    out.push(optionsFor(list, k));
    const v = p[k];
    if (v !== null && v !== undefined) list = list.filter((c) => pickValue(c, k) === v);
  }
  const [chargeRatios, concentrations, substrates, gels, holds] = out;
  return { chargeRatios, concentrations, substrates, gels, holds };
}

/** Drop choices that no longer exist (e.g. a concentration not measured at the newly chosen charge ratio). */
export function normalizePick(conds: PickItem[], p: ExperimentPick): ExperimentPick {
  const out: ExperimentPick = { chargeRatio: null, concentration: null, substrate: null, gel: null, hold: null };
  let list = conds;
  for (const k of PICK_LEVELS) {
    const v = p[k] ?? null;
    const values = new Set(list.map((c) => pickValue(c, k)));
    out[k] = v !== null && values.has(v) ? v : null;
    if (out[k] !== null) list = list.filter((c) => pickValue(c, k) === out[k]);
  }
  return out;
}

/** "CR 0.25 · 2.5 M · glass · Gel A · 1 s", naming only what is chosen; "All experiments" if nothing is. */
export function pickTitle(p: ExperimentPick, o: PickOptions): string {
  const lists: [PickLevel, PickOption[]][] = [['chargeRatio', o.chargeRatios], ['concentration', o.concentrations], ['substrate', o.substrates], ['gel', o.gels], ['hold', o.holds]];
  const parts = lists.map(([k, list]) => {
    const v = p[k];
    if (v === null || v === undefined) return null;
    const label = list.find((x) => x.value === v)?.label ?? v;
    if (k === 'chargeRatio') return v === '—' ? 'Charge ratio unknown' : `CR ${label}`;
    if (k === 'concentration') return v === '—' ? 'Concentration unknown' : label;
    if (k === 'substrate') return v === '—' ? 'Substrate unknown' : label;
    if (k === 'gel') return v === '—' ? 'Gel unspecified' : label;
    return v === '—' ? 'Dwell unknown' : `${label} dwell`;
  }).filter(Boolean);
  return parts.length ? parts.join(' · ') : 'All experiments';
}
