import type { pickOptions } from '../analysis/experimentPick';
import type { ExperimentPick } from '../types';

const ALL = '__all__';

/** Dropdown with an "All" choice; null = all. */
function PickSelect({ label, value, options, allLabel, onChange }: { label: string; value: string | null; options: { value: string; label: string }[]; allLabel: string; onChange: (v: string | null) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value ?? ALL} onChange={(e) => onChange(e.target.value === ALL ? null : e.target.value)}>
        <option value={ALL}>{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function ExperimentPicker({ pick, options, setPick }: {
  pick: ExperimentPick;
  options: ReturnType<typeof pickOptions>;
  setPick: (patch: Partial<ExperimentPick>) => void;
}) {
  const defaultConc = options.concentrations.find((o) => o.value === pick.concentration)?.label.includes('default');
  return (
    <>
      <PickSelect label="Charge ratio" value={pick.chargeRatio} options={options.chargeRatios} allLabel="All charge ratios" onChange={(v) => setPick({ chargeRatio: v })} />
      <PickSelect label="Total monomer concentration" value={pick.concentration} options={options.concentrations} allLabel="All concentrations" onChange={(v) => setPick({ concentration: v })} />
      <PickSelect label="Substrate" value={pick.substrate} options={options.substrates} allLabel="All substrates" onChange={(v) => setPick({ substrate: v })} />
      {defaultConc && <p className="hint warn">No concentration was found in the folder names, so 2.1 M is assumed.</p>}
    </>
  );
}
