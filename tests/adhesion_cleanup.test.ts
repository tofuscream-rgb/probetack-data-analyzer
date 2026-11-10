import { describe, expect, it } from 'vitest';
import { analyzeTack } from '../src/analysis/tackMetrics';
import { analyzeLapShear } from '../src/analysis/lapShear';
import { defaultLapShear } from '../src/state/defaults';
import { GF_TO_N } from '../src/types';

describe('adhesion cleanup', () => {
  it('leaves true tack failure blank when detachment is incomplete', () => {
    const r=analyzeTack({z_mm:[10,9.5,9,8.5],force_gf:[0,-1/GF_TO_N,-2/GF_TO_N,-1/GF_TO_N],holdForce_gf:null},{diameterMm:5.5,h0Mm:2});
    expect(r.incomplete).toBe(true); expect(r.failureDispMm).toBeNull(); expect(r.epsMax).toBeNull(); expect(Number.isFinite(r.wJm2)).toBe(true);
  });
  it('does not require lap-shear thickness for strength', () => {
    const s=defaultLapShear().settings;
    const r=analyzeLapShear({time_s:[0,1,2,3,4,5],z_mm:[0,-1,-2,-3,-4,-5],force_gf:[0,-10,-20,-30,-1,-1],amplitudeMm:-5},{lengthMm:25,widthMm:10,thicknessMm:0,failureMode:'unspecified',manualFailureMm:null},s);
    expect(r.areaMm2).toBe(250); expect(Number.isFinite(r.strengthKPa)).toBe(true);
  });
  it('keeps work-to-failure null when no failure is identified', () => {
    const s={...defaultLapShear().settings,failure:{auto:false,fraction:0.05,consecutive:20}};
    const r=analyzeLapShear({time_s:[0,1,2,3],z_mm:[0,-1,-2,-3],force_gf:[0,-10,-20,-10],amplitudeMm:-3},{lengthMm:25,widthMm:10,thicknessMm:1,failureMode:'unspecified',manualFailureMm:null},s);
    expect(r.failure.dispMm).toBeNull(); expect(r.work.toFailurePerAreaJm2).toBeNull();
  });
});
