/**
 * Data sets for the Compare charge ratios tab. A data set is one substrate ×
 * charge ratio × total monomer concentration; its runs are summarised per
 * holding time. Substrate names are compared case-insensitively ("ss" = "SS").
 * Concentration is always part of a data set, so concentrations are never mixed.
 */
import type { CompareSelection } from '../types';
import { computeGroups, groupValue, type CycleResult, type GroupStats } from './engine';

export interface Choice {
  value: string;
  label: string;
}

export interface DataSet {
  key: string;
  substrate: string; // lower-case key
  substrateLabel: string;
  chargeRatio: string;
  concentration: string;
  /** No concentration in any folder name: 2.1 M was assumed. */
  concentrationDefault: boolean;
  hidden: boolean;
}

export interface Comparison {
  substrates: Choice[];
  chargeRatios: string[];
  concentrations: string[];
  holdTimes: string[];
  /** Effective selection (defaults filled in, unavailable values dropped). */
  selected: { substrates: string[]; chargeRatios: string[]; concentrations: string[]; holdTimes: string[] };
  /** Every data set matching the selection, in chart order; `hidden` ones were unticked. */
  sets: DataSet[];
  stats: (set: DataSet, hold: string) => GroupStats | undefined;
}

export const substrateKey = (r: CycleResult) => groupValue(r, 'substrate').trim().toLowerCase();

const num = (v: string) => Number(v);
export function byNumber(a: string, b: string): number {
  const x = num(a);
  const y = num(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return Number.isFinite(x) ? -1 : Number.isFinite(y) ? 1 : a.localeCompare(b);
}
const uniq = (v: string[]) => [...new Set(v)].sort(byNumber);
const keep = (sel: string[] | null, avail: string[], fallback: string[]) => (sel === null ? fallback : sel.filter((v) => avail.includes(v)));

export function buildComparison(runs: CycleResult[], sel: CompareSelection, preferredSubstrate: string | null = null): Comparison {
  // Substrates with their most common spelling.
  const spell = new Map<string, Map<string, number>>();
  for (const r of runs) {
    const m = spell.get(substrateKey(r)) ?? new Map<string, number>();
    m.set(groupValue(r, 'substrate'), (m.get(groupValue(r, 'substrate')) ?? 0) + 1);
    spell.set(substrateKey(r), m);
  }
  const substrates = [...spell]
    .map(([value, m]) => ({ value, label: [...m].sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const subValues = substrates.map((s) => s.value);
  const pref = preferredSubstrate?.trim().toLowerCase() ?? null;
  const selSubs = keep(sel.substrates, subValues, pref && subValues.includes(pref) ? [pref] : subValues.slice(0, 1));

  const onSubs = runs.filter((r) => selSubs.includes(substrateKey(r)));
  const chargeRatios = uniq(onSubs.map((r) => groupValue(r, 'chargeRatio')));
  const selCr = keep(sel.chargeRatios, chargeRatios, chargeRatios);
  const onCr = onSubs.filter((r) => selCr.includes(groupValue(r, 'chargeRatio')));
  const concentrations = uniq(onCr.map((r) => groupValue(r, 'concentrationM')));
  const selConc = keep(sel.concentrations, concentrations, concentrations);
  const inSets = onCr.filter((r) => selConc.includes(groupValue(r, 'concentrationM')));
  const holdTimes = uniq(inSets.map((r) => groupValue(r, 'holdTimeS')));
  const selHold = keep(sel.holdTimes, holdTimes, holdTimes);

  // Statistics per substrate, so differently capitalised spellings are pooled.
  const index = new Map<string, GroupStats>();
  for (const s of selSubs) {
    const groups = computeGroups(inSets.filter((r) => substrateKey(r) === s), ['chargeRatio', 'concentrationM', 'holdTimeS']);
    for (const g of groups) index.set(`${s}|${g.label.chargeRatio}|${g.label.concentrationM}|${g.label.holdTimeS}`, g);
  }

  const sets = new Map<string, DataSet>();
  for (const r of inSets) {
    const s = substrateKey(r);
    const cr = groupValue(r, 'chargeRatio');
    const c = groupValue(r, 'concentrationM');
    const key = `${s}|${cr}|${c}`;
    const prev = sets.get(key);
    const isDefault = r.meta.concentrationM.source === 'default';
    if (prev) prev.concentrationDefault = prev.concentrationDefault && isDefault;
    else
      sets.set(key, {
        key,
        substrate: s,
        substrateLabel: substrates.find((x) => x.value === s)?.label ?? s,
        chargeRatio: cr,
        concentration: c,
        concentrationDefault: isDefault,
        hidden: sel.hiddenSets.includes(key),
      });
  }
  const dir = sel.order === 'asc' ? 1 : -1;
  const ordered = [...sets.values()].sort(
    (a, b) => selSubs.indexOf(a.substrate) - selSubs.indexOf(b.substrate) || dir * byNumber(a.chargeRatio, b.chargeRatio) || byNumber(a.concentration, b.concentration),
  );

  return {
    substrates,
    chargeRatios,
    concentrations,
    holdTimes,
    selected: { substrates: selSubs, chargeRatios: selCr, concentrations: selConc, holdTimes: selHold },
    sets: ordered,
    stats: (set, hold) => index.get(`${set.key}|${hold}`),
  };
}
