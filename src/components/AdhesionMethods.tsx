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
        {
          title: 'Modified Z-score and review',
          tex: String.raw`Z_i=0.6745(x_i-\operatorname{median}(x))/\operatorname{MAD}(x)`,
          text: 'MAD is the median absolute deviation from the median. The analyzer uses its existing mean absolute deviation fallback when MAD is zero. Flags are screening aids. Group summaries give mean ± sample SD and the number of finite observations for each metric.',
          refs: ['nistOutliers'], note: 'Thresholds, minimum group size and the zero-MAD fallback are analyzer settings or conventions.',
        },
      ]} />
    </details>
  );
}
