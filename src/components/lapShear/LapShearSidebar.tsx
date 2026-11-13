import { useApp } from '../../state/AppContext';
import { useLapShear } from '../../state/lapShear';
import { ImportStep } from '../Sidebar';
import { groupedRunFiles, RunPicker } from '../RunPicker';
import { ExperimentPicker } from '../ExperimentPicker';

/** Lap Shear sidebar: its own files (step 1) and the runs to graph and analyse (step 2). */
export function LapShearSidebar() {
  const { files, meta } = useApp();
  const { ls, runs, picked, pick, options, setPick, selectedIds, setSelected } = useLapShear();
  const { files: pickedFiles, names, groupOf } = groupedRunFiles(files, picked, meta);
  return (
    <nav className="sidebar" aria-label="Open lap-shear files and choose runs">
      <ImportStep />
      <section className="step">
        <h2>2. Choose your experiment</h2>
        {!runs.length ? (
          <p className="hint">
            Open your lap-shear TXT files first. Folder names such as <em>Gel A/0.25 2.98M/glass/</em> give the gel, charge ratio, concentration and substrate.
          </p>
        ) : (
          <>
            <ExperimentPicker pick={pick} options={options} setPick={setPick} />
            <p className="hint">{pickedFiles.length} file(s), {picked.length} run(s) in this choice.</p>
          </>
        )}
      </section>
      {runs.length > 0 && (
        <section className="step">
          <h2>3. Runs on the graph</h2>
          <RunPicker
            files={pickedFiles}
            runs={picked.map((r) => ({ id: r.id, fileId: r.file.fileId, cycleNumber: r.cycle.cycleNumber, ok: r.result.ok, error: r.result.error, peakGf: r.result.peak?.forceGf ?? null, leftOut: (ls.analysisInclusion ?? {})[r.id] === false }))}
            selectedIds={selectedIds}
            setSelected={setSelected}
            nameOf={(l) => names.get(l.parsed.fileId) ?? l.parsed.name}
            groupOf={groupOf}
            hint="Tick files (all their runs) or open a file (▸) to tick single runs. Unticking only removes a run from the graph; to leave it out of the averages, untick In average in Data analysis. Each run keeps its own dimensions and failure mode (Lap Shear metrics tab)."
          />
        </section>
      )}
    </nav>
  );
}
