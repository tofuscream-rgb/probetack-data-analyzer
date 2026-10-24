/**
 * The "Choose your experiment" step: dropdown options built from the imported
 * files (charge ratio → concentration → substrate → TXT file) and the files and
 * runs that the Graph and Data analysis tabs show.
 */
import { useCallback, useMemo } from 'react';
import { useApp } from './AppContext';
import { groupValue, type CycleResult } from '../analysis/engine';
import type { ExperimentSelection, ParsedFile } from '../types';

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

const numericFirst = (a: string, b: string) => {
  const x = Number(a);
  const y = Number(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  if (Number.isFinite(x)) return -1;
  if (Number.isFinite(y)) return 1;
  return a.localeCompare(b, undefined, { numeric: true });
};

const pick = (stored: string | null, options: Option[]) => (stored !== null && options.some((o) => o.value === stored) ? stored : options[0]?.value ?? null);

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

  const first = (e: ExperimentFile) => e.runs[0];
  const cr = (e: ExperimentFile) => groupValue(first(e), 'chargeRatio');
  const conc = (e: ExperimentFile) => groupValue(first(e), 'concentrationM');
  const sub = (e: ExperimentFile) => groupValue(first(e), 'substrate');

  const result = useMemo(() => {
    const options = (list: ExperimentFile[], key: (e: ExperimentFile) => string, label: (v: string, l: ExperimentFile[]) => string): Option[] =>
      [...new Set(list.map(key))].sort(numericFirst).map((v) => ({ value: v, label: label(v, list.filter((e) => key(e) === v)) }));

    const crOptions = options(byFile, cr, (v) => (v === '—' ? 'unknown' : v));
    const chargeRatio = pick(sel.chargeRatio, crOptions);
    const inCr = byFile.filter((e) => cr(e) === chargeRatio);
    const concOptions = options(inCr, conc, (v, l) => `${v} M${l.every((e) => first(e).meta.concentrationM.source === 'default') ? ' (default)' : ''}`);
    const concentrationM = pick(sel.concentrationM, concOptions);
    const inConc = inCr.filter((e) => conc(e) === concentrationM);
    const substrateOptions = options(inConc, sub, (v) => (v === '—' ? 'unknown' : v));
    const substrate = pick(sel.substrate, substrateOptions);
    const files = inConc
      .filter((e) => sub(e) === substrate)
      .sort((a, b) => (a.holdTimeS ?? Infinity) - (b.holdTimeS ?? Infinity) || (a.repeat ?? 0) - (b.repeat ?? 0) || a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    const main = files.find((e) => e.file.fileId === sel.fileId) ?? files[0] ?? null;
    const overlayFiles = sel.overlay ? files.filter((e) => e !== main && sel.overlayFileIds.includes(e.file.fileId)) : [];
    const graphFiles = main ? [main, ...overlayFiles] : [];
    return {
      crOptions,
      concOptions,
      substrateOptions,
      chargeRatio,
      concentrationM,
      substrate,
      overlay: sel.overlay,
      /** Every file of the chosen experiment, sorted by holding time and repeat. */
      files,
      main,
      overlayFiles,
      graphFiles,
      /** Runs drawn on the graph: the main file plus overlaid files. */
      graphRuns: graphFiles.flatMap((e) => e.runs),
      /** All runs of the chosen experiment. */
      experimentRuns: files.flatMap((e) => e.runs),
      title: main ? experimentTitle(main.runs[0]) : '',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byFile, sel]);

  const set = useCallback((patch: Partial<ExperimentSelection>) => update((p) => ({ ...p, experiment: { ...p.experiment, ...patch } })), [update]);
  return { ...result, set, hasData: byFile.length > 0 };
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
