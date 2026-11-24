import type { TareResult } from '../../analysis/peel';
import { fmt } from '../common';
import type { PeelRun } from '../../state/peel';

/** Badge of a run's tare check: amber = possible offset, grey = cannot check, blue = corrected. */
export function TareBadge({ t, applied }: { t: TareResult | null; applied: boolean }) {
  if (!t) return null;
  if (applied) return <span className="tare-badge corrected" title={`Tare corrected: ${fmt(t.residualGf, 2)} gf subtracted`}>tare corrected</span>;
  if (t.status === 'flagged') return <span className="tare-badge flagged" title={`Possible tare offset: ${fmt(t.residualGf, 2)} gf after detachment`}>tare offset?</span>;
  if (t.status === 'cannotCheck') return <span className="tare-badge cannot" title={t.reason}>can’t check</span>;
  return null;
}

/** Tare-check section of a peel run's details: the measured residual, the window, and the correction toggle. */
export function TarePanel({ run, onToggle }: { run: PeelRun; onToggle: (on: boolean) => void }) {
  const t = run.result.tare;
  const applied = run.meta.tareCorrection?.applied === true && t?.valid === true;
  if (!t) return <><h4>Tare check</h4><p className="note">The tare check is switched off (Settings).</p></>;
  return (
    <section className={`tare-panel ${t.status}`}>
      <h4>Tare check after detachment</h4>
      <p className={`note ${t.status === 'flagged' ? 'warn' : ''}`}>
        {t.status === 'flagged' ? `Possible tare offset: the force did not return to zero after detachment (${fmt(t.residualGf, 2)} gf).`
          : t.status === 'ok' ? 'The force returned to zero after detachment.'
          : t.reason}
      </p>
      <label className="check-row">
        <input type="checkbox" checked={applied} disabled={!t.valid} onChange={(e) => onToggle(e.target.checked)} /> Correct for tare offset
      </label>
      {!t.valid && <p className="note">Only runs with a valid residual can be corrected.</p>}
      <dl className="meta-grid">
        <dt>Residual</dt><dd>{fmt(t.residualGf, 2)} gf ({fmt(t.residualJm2, 2)} J/m², {fmt(t.residualPctPlateau, 1)} % of the plateau)</dd>
        <dt>Drift</dt><dd>{fmt(t.driftGf, 2)} gf <small>(second half − first half of the window)</small></dd>
        <dt>Window</dt><dd>{Number.isFinite(t.windowFromMm) ? `${fmt(t.windowFromMm, 2)}–${fmt(t.windowToMm, 2)} mm (${t.nWindow} points)` : '—'}</dd>
        <dt>Detachment</dt><dd>{t.detachMm === null ? 'not found' : `${fmt(t.detachMm, 2)} mm ${t.detachFrom === 'settled' ? '(where the force settles; no detachment detected)' : '(detected)'}`}</dd>
        {t.preTareGf !== null && <>
          <dt>Before Zero load</dt>
          <dd>
            Fz = {fmt(t.preTareGf, 2)} gf tared out; expected residual {fmt(t.expectedGf, 2)} gf
            {t.mismatch && Number.isFinite(t.residualGf) && <div className="note warn">The measured residual differs from the expected one by more than the threshold.</div>}
          </dd>
        </>}
        {applied && <><dt>Corrected</dt><dd>{fmt(t.residualGf, 2)} gf subtracted from the whole trace; all results of this run use the corrected trace.</dd></>}
      </dl>
    </section>
  );
}

/** Banner above the Peel tabs when runs did not return to zero after detachment. */
export function TareBanner({ runs, onCorrectAll, onUndoAll, onReview }: { runs: PeelRun[]; onCorrectAll: () => void; onUndoAll: () => void; onReview: () => void }) {
  const flagged = runs.filter((r) => r.result.tare?.status === 'flagged');
  const open = flagged.filter((r) => !r.meta.tareCorrection?.applied);
  const corrected = runs.filter((r) => r.meta.tareCorrection?.applied && r.result.tare?.valid);
  if (!flagged.length && !corrected.length) return null;
  return (
    <div className="tare-banner" role="status">
      <span>
        {flagged.length > 0
          ? <><strong>{flagged.length} run{flagged.length === 1 ? '' : 's'} did not return to zero after detachment (possible tare offset).</strong> Peel energy may be overestimated or underestimated.</>
          : null}
        {corrected.length > 0 && <> {corrected.length} run{corrected.length === 1 ? ' is' : 's are'} tare corrected.</>}
      </span>
      <button className="small" disabled={!open.length} onClick={onCorrectAll}>Correct all flagged</button>
      <button className="small" disabled={!corrected.length} onClick={onUndoAll}>Undo all corrections</button>
      <button className="small" disabled={!flagged.length} onClick={onReview}>Review</button>
    </div>
  );
}
