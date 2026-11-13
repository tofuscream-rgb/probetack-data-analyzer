import type { PickOption, PickOptions } from '../analysis/experimentPick';
import type { ExperimentPick } from '../types';

const ALL = '__all__';

const count = (o: { files: number; runs: number }) => `${o.files} file${o.files === 1 ? '' : 's'}, ${o.runs} run${o.runs === 1 ? '' : 's'}`;

/** Dropdown with an "All" choice (null) and the number of files and runs behind each value. */
function PickSelect({ label, value, options, allLabel, onChange }: { label: string; value: string | null; options: PickOption[]; allLabel: string; onChange: (v: string | null) => void }) {
  const total = { files: options.reduce((s, o) => s + o.files, 0), runs: options.reduce((s, o) => s + o.runs, 0) };
  return (
    <label className="field pick-field">
      <span>{label}</span>
      <select value={value ?? ALL} onChange={(e) => onChange(e.target.value === ALL ? null : e.target.value)}>
        <option value={ALL}>{allLabel} ({count(total)})</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label} ({count(o)})</option>)}
      </select>
    </label>
  );
}

/**
 * "Choose your experiment", the same in every test: charge ratio → concentration → substrate →
 * gel → dwell time. Each list offers only what was measured with the choices above it.
 */
export function ExperimentPicker({ pick, options, setPick }: {
  pick: ExperimentPick;
  options: PickOptions;
  setPick: (patch: Partial<ExperimentPick>) => void;
}) {
  const assumed = options.concentrations.some((o) => o.label.includes('assumed') && (pick.concentration === null || pick.concentration === o.value));
  const unknown = [
    options.chargeRatios.some((o) => o.value === '—') && 'charge ratio',
    options.substrates.some((o) => o.value === '—') && 'substrate',
  ].filter(Boolean);
  return (
    <div className="experiment-picker">
      <PickSelect label="Charge ratio" value={pick.chargeRatio} options={options.chargeRatios} allLabel="All" onChange={(v) => setPick({ chargeRatio: v })} />
      <PickSelect label="Concentration (M)" value={pick.concentration} options={options.concentrations} allLabel="All" onChange={(v) => setPick({ concentration: v })} />
      <PickSelect label="Substrate" value={pick.substrate} options={options.substrates} allLabel="All" onChange={(v) => setPick({ substrate: v })} />
      {/* Only when the data have them: a gel named in the folders, a dwell time in the files. */}
      {options.gels.some((o) => o.value !== '—') && <PickSelect label="Gel" value={pick.gel} options={options.gels} allLabel="All" onChange={(v) => setPick({ gel: v })} />}
      {options.holds.some((o) => o.value !== '—') && <PickSelect label="Dwell time" value={pick.hold} options={options.holds} allLabel="All" onChange={(v) => setPick({ hold: v })} />}
      {assumed && <p className="hint warn">No concentration was found in some folder names; 2.1 M is assumed for those files. Correct it in a run’s details if needed.</p>}
      {unknown.length > 0 && <p className="hint">“unknown” = the {unknown.join(' or ')} could not be read from the folder or file names.</p>}
    </div>
  );
}
