import { useState } from 'react';
import { useApp, download } from '../../state/AppContext';
import { usePeel } from '../../state/peel';
import { buildPeelWorkbook } from '../../export/peelWorkbook';
import { Dialog } from '../Dialog';

export function PeelExportDialog({ onClose }: { onClose: () => void }) {
  const { project, filesByMode, notify } = useApp();
  const files = filesByMode.peel;
  const { ps, runs, selected } = usePeel();
  const [scope, setScope] = useState<'selected' | 'all'>('selected');
  const [runData, setRunData] = useState(true);
  const [chart, setChart] = useState(true);
  const list = scope === 'selected' ? selected : runs;
  const points = list.reduce((s, r) => s + r.result.curve.nPoints, 0);

  const go = () => {
    try {
      const off = new Set(project.peel.disabledFiles);
      const bytes = buildPeelWorkbook({
        projectName: project.name,
        settings: ps.settings,
        includeRunData: runData,
        includeChart: chart,
        deselectedFiles: files.filter((l) => off.has(l.parsed.fileId)).map((l) => ({ path: l.parsed.path, sha256: l.parsed.sha256 })),
        runs: list.map((r) => ({
          label: r.label,
          filePath: r.file.path,
          condition: r.condition,
          time_s: r.cycle.time_s,
          z_mm: r.cycle.z_mm,
          force_gf: r.cycle.force_gf,
          failureMode: r.meta.failureMode,
          result: r.result,
        })),
      });
      const safe = project.name.replace(/[^\w.-]+/g, '_') || 'Mach1_Analysis';
      download(bytes, `${safe}_peel_90_${new Date().toISOString().slice(0, 10)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      notify('success', `90° peel workbook created with ${list.length} run(s).`);
      onClose();
    } catch (e) {
      notify('error', `Excel export failed: ${(e as Error).message}`);
    }
  };

  return (
    <Dialog title="Export 90° peel results to Excel" onClose={onClose}>
      <fieldset>
        <legend>Which runs</legend>
        <label className="radio"><input type="radio" checked={scope === 'selected'} onChange={() => setScope('selected')} /> Selected runs ({selected.length})</label>
        <label className="radio"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> All runs of the ticked files ({runs.length})</label>
      </fieldset>
      <fieldset>
        <legend>What to include</legend>
        <label className="radio"><input type="checkbox" checked disabled /> <span><strong>Peel Summary</strong> <small>every run's plateau force, peel strength, toughness, peak, work, gel dimensions, failure mode, and mean ± SD</small></span></label>
        <label className="radio"><input type="checkbox" checked={chart} onChange={(e) => setChart(e.target.checked)} /> <span><strong>Peel Chart</strong> <small>editable Excel chart of peel force vs displacement</small></span></label>
        <label className="radio"><input type="checkbox" checked={runData} onChange={(e) => setRunData(e.target.checked)} /> <span><strong>One sheet per run</strong> <small>time, original position, displacement, original signed force, corrected force, peak, steady-state window, cumulative work ({points.toLocaleString()} rows in total)</small></span></label>
        <label className="radio"><input type="checkbox" checked disabled /> <span><strong>Analysis Settings</strong> <small>steady-state window, detachment, integration, baseline and formulas</small></span></label>
      </fieldset>
      <p className="note">The workbook is built in this browser. The original TXT files are not changed.</p>
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!list.length} onClick={go}>Download workbook</button>
      </div>
    </Dialog>
  );
}
