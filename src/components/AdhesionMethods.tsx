import { EquationList, type EquationItem } from './EquationList';

type Mode = 'tack' | 'lapShear' | 'peel';

const primary: Record<Mode, EquationItem> = {
  tack: {
    title: 'Probe Tack: tensile pull-off',
    tex: String.raw`F_{\max}=\max F_{\mathrm{tensile}},\qquad A=\pi d^2/4`,
    text: 'The work integral uses the tensile pull from onset to detachment. Enter the probe diameter d to also see apparent work per initial contact area. An asterisk marks a pull that ended before detachment was detected.',
    refs: ['creton2016', 'lakrout1999'], note: 'Probe-tack force and work depend on geometry and test conditions.',
  },
  lapShear: {
    title: 'Lap Shear: apparent nominal strength',
    tex: String.raw`\tau_{\max}=F_{\max}/(L W)`,
    text: 'Peak load divided by initial overlap area. Gel thickness does not enter this formula. Work uses the loading curve up to detected or manually entered failure.',
    refs: ['astmD1002', 'wang2020'], note: 'The metal-joint strength convention is applied by analogy to gel joints. Work per area can include bulk deformation and friction.',
  },
  peel: {
    title: '90° Peel: steady-state force and peel energy',
    tex: String.raw`G_{\mathrm{peel}}=(\bar F_{\mathrm{ss}}/w)(1-\cos\theta)`,
    text: 'Average force is measured in the steady-state window. At 90°, the geometric term is one. The expression neglects the peel arm elastic stretching term. Wadh integrates the loading curve to detachment and is reported separately.',
    refs: ['astmD6862', 'kendall1975', 'bartlett2023'], note: 'Use the force plateau and specimen width for the steady-state peel metric.',
  },
};

export function WorkMethods({ mode }: { mode: Mode }) {
  return (
    <details className="section">
      <summary>Methods, formulas and references</summary>
      <EquationList title="Data analysis methods" items={[
        primary[mode],
        {
          title: 'Measured mechanical work',
          tex: String.raw`W_{\mathrm{adh}}=\int F\,\mathrm{d}\delta,\qquad 1\;\mathrm{N\,mm}=1\;\mathrm{mJ}`,
          text: 'The analyzer uses trapezoids on force in N versus displacement in mm. An asterisk identifies work through the recorded endpoint when failure or detachment was not detected. Treat Wadh as a geometry- and interval-dependent measurement.',
          refs: ['creton2016', ...(mode === 'lapShear' ? ['wang2020'] : mode === 'peel' ? ['bartlett2023'] : [])],
          note: 'Integration limits and fallback to recorded displacement are analyzer conventions.',
        },
        ...(mode !== 'tack' ? [] : [{
          title: 'Modified Z-score and review',
          tex: String.raw`Z_i=\frac{0.6745\,(x_i-\tilde{x})}{\operatorname{MAD}},\qquad \operatorname{MAD}=\operatorname{median}\lvert x_i-\tilde{x}\rvert;\qquad \lvert Z_i\rvert \ge 2.5\ \text{yellow},\ \ge 3.5\ \text{orange},\ \ge 5\ \text{red}`,
          text: 'x = peak adhesion force of each run, x̃ = median of the runs with the same conditions. Flags are warnings for review; exclusion is only by whole file/session, chosen manually. A single run can also be left out by hand with In average. With the default settings no flag colour removes a run from the statistics.',
          refs: ['iglewicz1993', 'nistOutliers', 'leys2013'],
          note: 'Modified Z-score and the |Z| > 3.5 cut-off for potential outliers: Iglewicz & Hoaglin (1993), as given in the NIST/SEMATECH e-Handbook (§1.3.5.17). Yellow level 2.5: the moderately conservative median ± 2.5 MAD criterion of Leys et al. (2013) (their MAD is scaled by 1.4826 = 1/0.6745, so the two scales agree). The red level (5), the minimum of n = 4 valid runs per condition and the mean-absolute-deviation fallback when MAD = 0 are analyzer choices.',
        }]),
      ]} />
    </details>
  );
}
