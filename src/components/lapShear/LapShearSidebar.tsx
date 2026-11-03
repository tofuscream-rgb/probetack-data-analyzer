import { useApp } from '../../state/AppContext';
import { useLapShear } from '../../state/lapShear';
import { ImportStep } from '../Sidebar';
import { RunPicker } from '../RunPicker';

/** Lap Shear sidebar: its own files (step 1) and the runs to graph and analyse (step 2). */
export function LapShearSidebar() {
  const { filesByMode, project } = useApp();
  const { ls, runs, selectedIds, set, setSelected } = useLapShear();
  const off = new Set(project.lapShear.disabledFiles);
  return (
    <nav className="sidebar" aria-label="Open lap-shear files and choose runs">
      <ImportStep />
      <section className="step">
        <h2>2. Choose runs</h2>
        {!runs.length ? (
          <p className="hint">
            Open your lap-shear TXT files first. Every <em>&lt;Move Relative&gt;</em> section of a file is one run; a file with three pulls gives Run 1, Run 2 and Run 3.
          </p>
        ) : (
          <RunPicker
            files={filesByMode.lapShear.filter((l) => !off.has(l.parsed.fileId))}
            runs={runs.map((r) => ({ id: r.id, fileId: r.file.fileId, cycleNumber: r.cycle.cycleNumber, ok: r.result.ok, error: r.result.error, peakGf: r.result.peak?.forceGf ?? null }))}
            fileId={ls.fileId}
            onFile={(id) => set({ fileId: id })}
            selectedIds={selectedIds}
            setSelected={setSelected}
            hint="Ticked runs are drawn on the graph and listed in the results. Each run keeps its own overlap dimensions and failure mode (Results tab)."
          />
        )}
      </section>
    </nav>
  );
}
