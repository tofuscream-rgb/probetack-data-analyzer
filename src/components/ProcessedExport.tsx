import { useMemo, useState } from 'react';
import { useApp, download } from '../state/AppContext';
import { useExperiment } from '../state/experiment';
import { useLapShear } from '../state/lapShear';
import { usePeel } from '../state/peel';
import { isIncluded, type CycleResult } from '../analysis/engine';
import { analyzeTack } from '../analysis/tackMetrics';
import { runCondition } from '../analysis/runCompare';
import { includedRuns, lapShearAnalysisRow, peelAnalysisRow } from '../analysis/adhesionReview';
import { buildProcessedWorkbook, type ProcessedRow, type SummarySheet } from '../export/processedWorkbook';
import type { ExperimentMode, ProjectState } from '../types';
import { Dialog } from './Dialog';

type Scope = 'experiment' | 'graph' | 'all';

const SHEETS: { key: SummarySheet; label: string; description: string }[] = [
  { key: 'run', label: 'Per run', description: 'One row per included run' },
  { key: 'repeat', label: 'Per repeat', description: 'Mean, sample SD and n across runs in each file and condition' },
  { key: 'condition', label: 'Per condition', description: 'Mean, sample SD and n across repeat means. Each repeat counts once.' },
];

function ReportDialog({ mode, counts, getRows, onClose }: {
  mode: ExperimentMode;
  counts: Record<Scope, number>;
  getRows: (scope: Scope) => ProcessedRow[];
  onClose: () => void;
}) {
  const { project, notify } = useApp();
  const [scope, setScope] = useState<Scope>(() => counts.experiment ? 'experiment' : counts.all ? 'all' : 'experiment');
  const [sheets, setSheets] = useState<SummarySheet[]>(SHEETS.map((s) => s.key));
  const save = () => {
    try {
      const rows = getRows(scope);
      const workbook = buildProcessedWorkbook(project.name, mode, rows, sheets);
      const file = project.name.replace(/[^\w.-]+/g, '_') || 'Mach1_Analysis';
      const test = { tack: 'probe_tack', lapShear: 'lap_shear', peel: '90_peel' }[mode];
      download(workbook, `${file}_${test}_processed.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      notify('success', `Exported ${rows.length} included run(s).`);
      onClose();
    } catch (error) {
      notify('error', `Excel export failed: ${(error as Error).message}`);
    }
  };
  const scopes: { key: Scope; label: string }[] = [
    { key: 'experiment', label: 'Chosen experiment' },
    { key: 'graph', label: 'Runs on the graph' },
    { key: 'all', label: 'All enabled files' },
  ];
  return (
    <Dialog title="Export processed results to Excel" onClose={onClose}>
      <fieldset>
        <legend>Which runs</legend>
        {scopes.map(({ key, label }) => <label className="radio" key={key}>
          <input type="radio" name="processed-scope" checked={scope === key} disabled={!counts[key]} onChange={() => setScope(key)} />
          {label} ({counts[key]} included)
        </label>)}
      </fieldset>
      <fieldset>
        <legend>Which sheets</legend>
        {SHEETS.map(({ key, label, description }) => <label className="radio" key={key}>
          <input type="checkbox" checked={sheets.includes(key)} onChange={(e) => {
            const checked = e.target.checked;
            setSheets((current) => checked ? [...current, key] : current.filter((s) => s !== key));
          }} />
          <span><strong>{label}</strong> <small>{description}</small></span>
        </label>)}
      </fieldset>
      <p className="note">Uses the inclusion decisions in Data analysis. Work through the recorded end is marked when the separation endpoint is unavailable.</p>
      {!counts.all && <p className="note">No included runs to export. Review the files and inclusion decisions in Data analysis.</p>}
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!counts[scope] || !sheets.length} onClick={save}>Download workbook</button>
      </div>
    </Dialog>
  );
}

function tackRow(r: CycleResult, project: ProjectState): ProcessedRow {
  // The processed curve omits excluded samples and uses the configured baseline.
  const force = r.cycle.force_gf.map((value, i) => r.include[i] ? value - (r.baseline ?? 0) : NaN);
  const m = analyzeTack({ ...r.cycle, force_gf: force }, {
    diameterMm: project.settings.probe.diameterMm,
    h0Mm: project.tackMetrics.h0[r.file.fileId] ?? null,
    allowMissingArea: true,
  });
  return {
    id: r.cycle.cycleId, fileId: r.file.fileId, path: r.file.path, name: r.file.name, number: r.cycle.cycleNumber,
    cond: { ...runCondition(r.meta), hold: r.holdTimeS === null ? '—' : String(r.holdTimeS) }, gel: r.meta.gel.value,
    primary: m.fmaxN, peakN: m.fmaxN, normalized: m.sigmaMaxKPa, workMJ: m.workMJ, workPerArea: m.wJm2,
    incomplete: m.incomplete, note: m.error ?? '',
  };
}

function TackReport({ onClose }: { onClose: () => void }) {
  const { project, derived } = useApp();
  const ex = useExperiment();
  const all = useMemo(() => derived.ordered.filter(isIncluded).map((r) => tackRow(r, project)).filter((r) => Number.isFinite(r.peakN)), [derived, project]);
  const experiment = new Set(ex.experimentRuns.map((r) => r.cycle.cycleId));
  const graph = new Set(ex.graphRuns.map((r) => r.cycle.cycleId));
  const rows = { experiment: all.filter((r) => experiment.has(r.id)), graph: all.filter((r) => graph.has(r.id)), all };
  return <ReportDialog mode="tack" counts={{ experiment: rows.experiment.length, graph: rows.graph.length, all: rows.all.length }} getRows={(scope) => rows[scope]} onClose={onClose} />;
}

function RunReport({ mode, rows, picked, graphed, inclusion, onClose }: {
  mode: 'lapShear' | 'peel';
  rows: ProcessedRow[];
  picked: Set<string>;
  graphed: Set<string>;
  inclusion: Record<string, boolean>;
  onClose: () => void;
}) {
  const { project } = useApp();
  const included = useMemo(() => includedRuns(rows, project.settings.cycle, project.settings.runExclusion.excludeClasses, inclusion),
    [rows, project.settings.cycle, project.settings.runExclusion.excludeClasses, inclusion]);
  const all = rows.filter((r) => included.has(r.id));
  const scoped = { experiment: all.filter((r) => picked.has(r.id)), graph: all.filter((r) => graphed.has(r.id)), all };
  return <ReportDialog mode={mode} counts={{ experiment: scoped.experiment.length, graph: scoped.graph.length, all: all.length }} getRows={(scope) => scoped[scope]} onClose={onClose} />;
}

function LapShearReport({ onClose }: { onClose: () => void }) {
  const { meta } = useApp();
  const { ls, runs, picked, selected } = useLapShear();
  const rows = runs.map((r) => {
    const row = lapShearAnalysisRow(r, meta.get(r.file.fileId)?.gel.value ?? null);
    return { ...row, workPerArea: row.workMJ * 1000 / r.result.areaMm2 };
  });
  return <RunReport mode="lapShear" rows={rows} picked={new Set(picked.map((r) => r.id))} graphed={new Set(selected.map((r) => r.id))} inclusion={ls.analysisInclusion ?? {}} onClose={onClose} />;
}

function PeelReport({ onClose }: { onClose: () => void }) {
  const { meta } = useApp();
  const { ps, runs, picked, selected } = usePeel();
  const rows = runs.map((r) => peelAnalysisRow(r, meta.get(r.file.fileId)?.gel.value ?? null));
  return <RunReport mode="peel" rows={rows} picked={new Set(picked.map((r) => r.id))} graphed={new Set(selected.map((r) => r.id))} inclusion={ps.analysisInclusion ?? {}} onClose={onClose} />;
}

export function ProcessedExport({ mode, onClose }: { mode: ExperimentMode; onClose: () => void }) {
  if (mode === 'lapShear') return <LapShearReport onClose={onClose} />;
  if (mode === 'peel') return <PeelReport onClose={onClose} />;
  return <TackReport onClose={onClose} />;
}
