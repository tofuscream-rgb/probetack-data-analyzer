import { useApp } from '../../state/AppContext';
import { useLapShear } from '../../state/lapShear';
import { ImportStep } from '../Sidebar';
import { RunPicker } from '../RunPicker';

/** Lap Shear sidebar: its own files (step 1) and the runs to graph and analyse (step 2). */
export function LapShearSidebar() {
  const { filesByMode, project } = useApp();
  const { runs, selectedIds, setSelected } = useLapShear();
  const off = new Set(project.lapShear.disabledFiles);
  return (
    <nav className="sidebar" aria-label="Open lap-shear files and choose runs">
      <ImportStep />
      <section className="step">
        <h2>2. Choose files and runs to analyse</h2>
        {!runs.length ? (
          <p className="hint">
            Open your lap-shear TXT files first. Every <em>&lt;Move Relative&gt;</em> section of a file is one run; a file with three pulls gives Run 1, Run 2 and Run 3.
          </p>
        ) : (
          <RunPicker
            files={filesByMode.lapShear.filter((l) => !off.has(l.parsed.fileId))}
            runs={runs.map((r) => ({ id: r.id, fileId: r.file.fileId, cycleNumber: r.cycle.cycleNumber, ok: r.result.ok, error: r.result.error, peakGf: r.result.peak?.forceGf ?? null }))}
            selectedIds={selectedIds}
            setSelected={setSelected}
            hint="Tick any number of files (all their runs) or open a file (▸) to tick single runs. Ticked runs are drawn on the graph, listed in the results and used in Compare. Each run keeps its own dimensions and failure mode (Results tab)."
          />
        )}
      </section>
    </nav>
  );
}
