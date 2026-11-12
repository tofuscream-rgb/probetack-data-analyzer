import { useMemo } from 'react';
import { useApp } from '../state/AppContext';
import { useExperiment } from '../state/experiment';
import { useLapShear } from '../state/lapShear';
import { usePeel } from '../state/peel';
import { isIncluded } from '../analysis/engine';
import { pickTitle } from '../analysis/experimentPick';
import { includedRuns, lapShearAnalysisRow, peelAnalysisRow, type AnalysisRow } from '../analysis/adhesionReview';
import { MODE_LABEL } from '../state/AppContext';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Bar({ title, inChoice, onGraph, included }: { title: string; inChoice: [number, number]; onGraph: [number, number]; included: number }) {
  const { project } = useApp();
  return (
    <div className="context-bar" aria-label="Current selection">
      <span className={`mode-badge mode-${project.mode}`}>{MODE_LABEL[project.mode]}</span>
      <span className="ctx-title" title="Chosen experiment (sidebar step 2)">{title}</span>
      <span className="ctx-stat" title="Files and runs matching the chosen experiment">Chosen experiment: <strong>{plural(inChoice[0], 'file')} · {plural(inChoice[1], 'run')}</strong></span>
      <span className="ctx-stat" title="Runs drawn on the Graph tab (sidebar step 3)">Runs on the graph: <strong>{onGraph[1]}</strong></span>
      <span className="ctx-stat" title="Runs of the chosen experiment used for means and SDs after review in Data analysis">Included in average: <strong>{included}</strong> of {inChoice[1]}</span>
    </div>
  );
}

function TackBar() {
  const ex = useExperiment();
  if (!ex.hasData) return null;
  return <Bar title={ex.title} inChoice={[ex.files.length, ex.experimentRuns.length]} onGraph={[ex.graphFiles.length, ex.graphRuns.length]} included={ex.experimentRuns.filter(isIncluded).length} />;
}

function RunBar({ rows, picked, graphed, inclusion, title }: { rows: AnalysisRow[]; picked: Set<string>; graphed: { id: string; file: { fileId: string } }[]; inclusion: Record<string, boolean>; title: string }) {
  const { project } = useApp();
  const included = useMemo(() => includedRuns(rows, project.settings.cycle, project.settings.runExclusion.excludeClasses, inclusion), [rows, project.settings.cycle, project.settings.runExclusion.excludeClasses, inclusion]);
  const inChoice = rows.filter((r) => picked.has(r.id));
  return <Bar title={title} inChoice={[new Set(inChoice.map((r) => r.fileId)).size, inChoice.length]} onGraph={[new Set(graphed.map((r) => r.file.fileId)).size, graphed.length]} included={inChoice.filter((r) => included.has(r.id)).length} />;
}

function LapShearBar() {
  const { meta } = useApp();
  const { ls, runs, picked, selected, pick, options } = useLapShear();
  const rows = useMemo(() => runs.map((r) => lapShearAnalysisRow(r, meta.get(r.file.fileId)?.gel.value ?? null)), [runs, meta]);
  if (!runs.length) return null;
  return <RunBar rows={rows} picked={new Set(picked.map((r) => r.id))} graphed={selected} inclusion={ls.analysisInclusion ?? {}} title={pickTitle(pick, options)} />;
}

function PeelBar() {
  const { meta } = useApp();
  const { ps, runs, picked, selected, pick, options } = usePeel();
  const rows = useMemo(() => runs.map((r) => peelAnalysisRow(r, meta.get(r.file.fileId)?.gel.value ?? null)), [runs, meta]);
  if (!runs.length) return null;
  return <RunBar rows={rows} picked={new Set(picked.map((r) => r.id))} graphed={selected} inclusion={ps.analysisInclusion ?? {}} title={pickTitle(pick, options)} />;
}

/** One line above the tabs: test, chosen experiment, and how many runs are chosen, drawn and averaged. */
export function ContextBar() {
  const { project } = useApp();
  return project.mode === 'lapShear' ? <LapShearBar /> : project.mode === 'peel' ? <PeelBar /> : <TackBar />;
}
