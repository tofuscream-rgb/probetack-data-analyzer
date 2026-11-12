/**
 * The "Choose your experiment" step: dropdown options built from the imported
 * files (charge ratio → concentration → substrate → TXT file) and the files and
 * runs that the Graph and Data analysis tabs show.
 */
import { useCallback, useMemo } from 'react';
import { useApp } from './AppContext';
import { groupValue, type CycleResult } from '../analysis/engine';
import { bySubstrate } from '../analysis/substrates';
import { matchesPick, normalizePick, numericFirst, pickOptions, pickTitle, type PickItem } from '../analysis/experimentPick';
import type { ExperimentPick, ExperimentSelection, ParsedFile } from '../types';

export interface ExperimentFile {
  file: ParsedFile;
  /** Holding time used for sorting and labels (from the Wait blocks, else the file name). */
  holdTimeS: number | null;
  repeat: number | null;
  runs: CycleResult[];
}

export interface Option {
  value: string;
  label: string;
}

/** The chooser fields of a run (as used by every test's "Choose your experiment"). */
export function tackPickItem(r: CycleResult): PickItem {
  return {
    chargeRatio: groupValue(r, 'chargeRatio'),
    concentration: groupValue(r, 'concentrationM'),
    concentrationDefault: r.meta.concentrationM.source === 'default',
    substrate: groupValue(r, 'substrate'),
    gel: groupValue(r, 'gel'),
    hold: groupValue(r, 'holdTimeS'),
    fileId: r.file.fileId,
  };
}

/** Stored tack selection → shared pick (null = all; substrate and gel compared in lower case). */
const lower = (v: string | null | undefined) => (v === null || v === undefined ? null : v === '—' ? v : v.trim().toLowerCase());
const asPick = (s: ExperimentSelection): ExperimentPick => ({
  chargeRatio: s.chargeRatio ?? null,
  concentration: s.concentrationM ?? null,
  substrate: lower(s.substrate),
  gel: lower(s.gel),
  hold: s.hold ?? null,
});

const condOrder = (a: ExperimentFile, b: ExperimentFile) => {
  const x = tackPickItem(a.runs[0]);
  const y = tackPickItem(b.runs[0]);
  return numericFirst(x.chargeRatio, y.chargeRatio) || numericFirst(x.concentration, y.concentration) || bySubstrate(x.substrate, y.substrate)
    || (x.gel ?? '').localeCompare(y.gel ?? '', undefined, { numeric: true });
};

export function useExperiment() {
  const { derived, project, update } = useApp();
  const sel = project.experiment;

  const byFile = useMemo(() => {
    const m = new Map<string, ExperimentFile>();
    for (const r of derived.ordered) {
      const e = m.get(r.file.fileId) ?? { file: r.file, holdTimeS: r.holdTimeS, repeat: r.meta.repeat.value, runs: [] };
      e.runs.push(r);
      m.set(r.file.fileId, e);
    }
    return [...m.values()];
  }, [derived]);
  const items = useMemo(() => derived.ordered.map(tackPickItem), [derived]);

  const result = useMemo(() => {
    const pick = normalizePick(items, asPick(sel));
    const options = pickOptions(items, pick);
    const files = byFile
      .filter((e) => matchesPick(tackPickItem(e.runs[0]), pick))
      .sort((a, b) => condOrder(a, b) || (a.holdTimeS ?? Infinity) - (b.holdTimeS ?? Infinity) || (a.repeat ?? 0) - (b.repeat ?? 0) || a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    const main = files.find((e) => e.file.fileId === sel.fileId) ?? files[0] ?? null;
    const overlayFiles = sel.overlay ? files.filter((e) => e !== main && sel.overlayFileIds.includes(e.file.fileId)) : [];
    const graphFiles = main ? [main, ...overlayFiles] : [];
    return {
      pick,
      options,
      chargeRatio: pick.chargeRatio,
      concentrationM: pick.concentration,
      substrate: pick.substrate,
      overlay: sel.overlay,
      /** Every file of the chosen experiment, sorted by condition, holding time and repeat. */
      files,
      main,
      overlayFiles,
      graphFiles,
      /** Runs drawn on the graph: the main file plus overlaid files. */
      graphRuns: graphFiles.flatMap((e) => e.runs),
      /** All runs of the chosen experiment. */
      experimentRuns: files.flatMap((e) => e.runs),
      /** Chosen experiment, naming only what is chosen ("CR 0.25 · 2.5 M · glass"). */
      title: pickTitle(pick, options),
    };
  }, [byFile, items, sel]);

  const set = useCallback((patch: Partial<ExperimentSelection>) => update((p) => ({ ...p, experiment: { ...p.experiment, ...patch } })), [update]);
  /** Change the chooser (null = all); the file to view is kept when it is still part of the choice. */
  const setPick = useCallback((patch: Partial<ExperimentPick>) => {
    const next = normalizePick(items, { ...result.pick, ...patch });
    set({ chargeRatio: next.chargeRatio, concentrationM: next.concentration, substrate: next.substrate, gel: next.gel, hold: next.hold });
  }, [items, result.pick, set]);
  /** Whether a run belongs to the chosen experiment, optionally ignoring some choices (e.g. substrate). */
  const inPick = useCallback((r: CycleResult, ignore: Partial<ExperimentPick> = {}) => matchesPick(tackPickItem(r), { ...result.pick, ...ignore }), [result.pick]);
  return { ...result, set, setPick, inPick, hasData: byFile.length > 0 };
}

/** "Charge ratio 0.25 · 2.5 M · Glass" */
export function experimentTitle(r: CycleResult): string {
  const m = r.meta;
  return [
    m.chargeRatio.value !== null ? `Charge ratio ${m.chargeRatio.value}` : 'Charge ratio unknown',
    `${m.concentrationM.value} M${m.concentrationM.source === 'default' ? ' (default)' : ''}`,
    m.substrate.value ?? 'substrate unknown',
  ].join(' · ');
}

/**
 * Short, unique names for files: the file name, or the path below the folders all
 * files share when two files have the same name (e.g. "0.25 2.1M/ss/1s.txt").
 */
export function uniqueFileNames(files: { fileId: string; name: string; path: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const dupes = new Set(files.map((f) => f.name).filter((n, i, a) => a.indexOf(n) !== i));
  const split = files.map((f) => f.path.split('/'));
  let common = 0;
  while (split.length > 1 && split.every((p) => p.length > common + 1 && p[common] === split[0][common])) common++;
  files.forEach((f, i) => out.set(f.fileId, dupes.has(f.name) ? split[i].slice(common).join('/') : f.name));
  return out;
}
