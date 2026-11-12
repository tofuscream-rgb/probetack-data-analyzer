import { useApp } from '../../state/AppContext';
import { useLapShear } from '../../state/lapShear';
import { ImportStep } from '../Sidebar';
import { groupedRunFiles, RunPicker } from '../RunPicker';
import { ExperimentPicker } from '../ExperimentPicker';

/** Lap Shear sidebar: its own files (step 1) and the runs to graph and analyse (step 2). */
export function LapShearSidebar() {
  const { files, meta } = useApp();
  const { runs, picked, pick, options, setPick, selectedIds, setSelected } = useLapShear();
  const { files: pickedFiles, names, groupOf } = groupedRunFiles(files, picked, meta);
  return (
    <nav className="sidebar" aria-label="Open lap-shear files and choose runs">
      <ImportStep />
      <section className="step">
        <h2>2. Choose your experiment</h2>
        {!runs.length ? (
          <p className="hint">
            Open your lap-shear TXT files first. Folder names such as <em>0.25 2.98M/glass/</em> give the charge ratio, concentration and substrate.
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
          <h2>3. Files and runs</h2>
          <RunPicker
            files={pickedFiles}
            runs={picked.map((r) => ({ id: r.id, fileId: r.file.fileId, cycleNumber: r.cycle.cycleNumber, ok: r.result.ok, error: r.result.error, peakGf: r.result.peak?.forceGf ?? null }))}
            selectedIds={selectedIds}
            setSelected={setSelected}
            nameOf={(l) => names.get(l.parsed.fileId) ?? l.parsed.name}
            groupOf={groupOf}
            hint="Tick any number of files (all their runs) or open a file (▸) to tick single runs. Compare charge ratios uses the ticked runs of every experiment. Each run keeps its own dimensions and failure mode (Results tab)."
          />
        </section>
      )}
    </nav>
  );
}
