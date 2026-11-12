/**
 * Compare charge ratios for Lap Shear and 90° Peel: the ticked runs are grouped into
 * data sets (substrate × charge ratio × concentration, read from the folder names),
 * summarised per holding time (from the file name, when present) as mean ± SD.
 * Substrates are compared case-insensitively; concentrations are never mixed.
 */
import { bySubstrate } from './substrates';
import type { ExperimentMeta, RunCompareSelection } from '../types';
import { byNumber, type Choice } from './compare';
import { describe } from './lapShear';

/** Conditions of one run, read from its folder and file names. */
export interface RunCondition {
  substrate: string;
  chargeRatio: string;
  concentration: string;
  concentrationDefault: boolean;
  /** Holding time from the file name ("60s.txt"), or "—". */
  hold: string;
  /** Gel from the folder names, or "—" (unspecified). Optional for callers that do not track gels. */
  gel?: string;
}

export function runCondition(m: ExperimentMeta | undefined): RunCondition {
  return {
    substrate: m?.substrate.value ?? '—',
    chargeRatio: m?.chargeRatio.value === null || m?.chargeRatio.value === undefined ? '—' : String(m.chargeRatio.value),
    concentration: m?.concentrationM.value === null || m?.concentrationM.value === undefined ? '—' : String(m.concentrationM.value),
    concentrationDefault: m?.concentrationM.source === 'default',
    hold: m?.nominalHoldS.value === null || m?.nominalHoldS.value === undefined ? '—' : String(m.nominalHoldS.value),
    gel: m?.gel.value?.trim() || '—',
  };
}

/** The holding time from the Wait block when the file name gives none. */
export const withRecordedHold = (c: RunCondition, holdTimeS: number | null): RunCondition =>
  c.hold === '—' && holdTimeS !== null ? { ...c, hold: String(holdTimeS) } : c;

export interface CompareItem {
  id: string;
  cond: RunCondition;
  /** Property values of the run (e.g. strength, work per area), keyed like the mode's property list. */
  values: Record<string, number>;
  /** Included in the average after review (Data analysis); undefined = included. */
  included?: boolean;
}

export interface RunDataSet {
  key: string;
  substrate: string;
  substrateLabel: string;
  chargeRatio: string;
  concentration: string;
  concentrationDefault: boolean;
  /** Gel key (lower case) or "—", and its label ("unspecified" when no gel is in the folder names). */
  gel: string;
  gelLabel: string;
  hidden: boolean;
}

export interface RunComparison {
  substrates: Choice[];
  gels: Choice[];
  chargeRatios: string[];
  concentrations: string[];
  holdTimes: string[];
  selected: { substrates: string[]; gels: string[]; chargeRatios: string[]; concentrations: string[]; holdTimes: string[] };
  sets: RunDataSet[];
  /** mean ± SD (n) of a property for one data set and holding time. */
  stat: (set: RunDataSet, hold: string, metric: string) => { mean: number; sd: number; n: number };
}

const sub = (c: RunCondition) => c.substrate.trim().toLowerCase();
const gelOf = (c: RunCondition) => (!c.gel || c.gel === '—' ? '—' : c.gel.trim().toLowerCase());
const uniq = (v: string[]) => [...new Set(v)].sort(byNumber);
const keep = (sel: string[] | null, avail: string[], fallback: string[]) => (sel === null ? fallback : sel.filter((v) => avail.includes(v)));

export function buildRunComparison(allItems: CompareItem[], sel: RunCompareSelection): RunComparison {
  const items = sel.which === 'raw' ? allItems : allItems.filter((it) => it.included !== false);
  const spell = new Map<string, Map<string, number>>();
  for (const it of items) {
    const m = spell.get(sub(it.cond)) ?? new Map<string, number>();
    m.set(it.cond.substrate, (m.get(it.cond.substrate) ?? 0) + 1);
    spell.set(sub(it.cond), m);
  }
  const substrates = [...spell].map(([value, m]) => ({ value, label: value === '—' ? 'unknown' : [...m].sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => bySubstrate(a.label, b.label));
  const subValues = substrates.map((s) => s.value);
  const selSubs = keep(sel.substrates, subValues, subValues);
  const onSubsAll = items.filter((it) => selSubs.includes(sub(it.cond)));
  const gelSpell = new Map<string, string>();
  for (const it of onSubsAll) if (!gelSpell.has(gelOf(it.cond))) gelSpell.set(gelOf(it.cond), (it.cond.gel ?? '—').trim());
  const gels = [...gelSpell].map(([value, label]) => ({ value, label: value === '—' ? 'unspecified' : label }))
    .sort((a, b) => (a.value === '—' ? 1 : b.value === '—' ? -1 : a.label.localeCompare(b.label, undefined, { numeric: true })));
  const selGels = keep(sel.gels ?? null, gels.map((g) => g.value), gels.map((g) => g.value));
  const onSubs = onSubsAll.filter((it) => selGels.includes(gelOf(it.cond)));
  const chargeRatios = uniq(onSubs.map((it) => it.cond.chargeRatio));
  const selCr = keep(sel.chargeRatios, chargeRatios, chargeRatios);
  const onCr = onSubs.filter((it) => selCr.includes(it.cond.chargeRatio));
  const concentrations = uniq(onCr.map((it) => it.cond.concentration));
  const selConc = keep(sel.concentrations, concentrations, concentrations);
  const inSets = onCr.filter((it) => selConc.includes(it.cond.concentration));
  const holdTimes = uniq(inSets.map((it) => it.cond.hold));
  const selHold = keep(sel.holdTimes, holdTimes, holdTimes);

  const groups = new Map<string, CompareItem[]>();
  const sets = new Map<string, RunDataSet>();
  for (const it of inSets) {
    const gel = gelOf(it.cond);
    // Without a gel the key is the same as before gels were compared, so saved choices still apply.
    const key = `${sub(it.cond)}|${it.cond.chargeRatio}|${it.cond.concentration}${gel === '—' ? '' : `|gel:${gel}`}`;
    groups.set(`${key}|${it.cond.hold}`, [...(groups.get(`${key}|${it.cond.hold}`) ?? []), it]);
    const prev = sets.get(key);
    if (prev) prev.concentrationDefault = prev.concentrationDefault && it.cond.concentrationDefault;
    else
      sets.set(key, {
        key,
        substrate: sub(it.cond),
        substrateLabel: substrates.find((x) => x.value === sub(it.cond))?.label ?? it.cond.substrate,
        chargeRatio: it.cond.chargeRatio,
        concentration: it.cond.concentration,
        concentrationDefault: it.cond.concentrationDefault,
        gel,
        gelLabel: gels.find((g) => g.value === gel)?.label ?? gel,
        hidden: sel.hiddenSets.includes(key),
      });
  }
  const dir = sel.order === 'asc' ? 1 : -1;
  const gelOrder = (x: RunDataSet, y: RunDataSet) => gels.findIndex((g) => g.value === x.gel) - gels.findIndex((g) => g.value === y.gel);
  const ordered = [...sets.values()].sort(
    (a, b) => bySubstrate(a.substrateLabel, b.substrateLabel) || selSubs.indexOf(a.substrate) - selSubs.indexOf(b.substrate)
      || (sel.panelBy === 'chargeRatio'
        ? dir * byNumber(a.chargeRatio, b.chargeRatio) || byNumber(a.concentration, b.concentration) || gelOrder(a, b)
        : gelOrder(a, b) || dir * byNumber(a.chargeRatio, b.chargeRatio) || byNumber(a.concentration, b.concentration)),
  );
  return {
    substrates,
    gels,
    chargeRatios,
    concentrations,
    holdTimes,
    selected: { substrates: selSubs, gels: selGels, chargeRatios: selCr, concentrations: selConc, holdTimes: selHold },
    sets: ordered,
    stat: (set, hold, metric) => describe((groups.get(`${set.key}|${hold}`) ?? []).map((it) => it.values[metric])),
  };
}

/** "0.25 · 2.98 M · glass", or '' when the folder and file names give no conditions. */
export function conditionLabel(c: RunCondition): string {
  const parts = [
    c.chargeRatio !== '—' ? c.chargeRatio : null,
    c.concentration !== '—' && !c.concentrationDefault ? `${c.concentration} M` : null,
    c.substrate !== '—' ? c.substrate : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '';
}

/**
 * Legend labels for runs: the conditions from the folder and file names, "Run k" when a
 * file holds several runs, and the file name (or path) only where labels would repeat.
 */
export function runLabels(runs: { fileId: string; fileName: string; uniqueName: string; cycleNumber: number; runsInFile: number; cond: RunCondition }[]): string[] {
  const base = runs.map((r) => {
    const c = conditionLabel(r.cond);
    const run = r.runsInFile > 1 ? `Run ${r.cycleNumber}` : '';
    return c ? [c, run].filter(Boolean).join(' – ') : `${r.uniqueName} – Run ${r.cycleNumber}`;
  });
  const count = (l: string, arr: string[]) => arr.filter((x) => x === l).length;
  const step1 = base.map((l, i) => (count(l, base) > 1 && conditionLabel(runs[i].cond) ? `${l} (${runs[i].fileName})` : l));
  return step1.map((l, i) => (count(l, step1) > 1 && conditionLabel(runs[i].cond) ? `${base[i]} (${runs[i].uniqueName})` : l));
}
