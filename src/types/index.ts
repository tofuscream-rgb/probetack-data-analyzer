/** Shared data types. Raw measurement arrays are never mutated after parsing. */

export const APP_VERSION = '1.7.1';
/** Bump whenever a calculation, scoring rule or default changes results. */
export const ALGORITHM_VERSION = '1.1.0';
/** 2: per-run overrides (runOverrides) replace excludedCycles; older projects are migrated on load. */
export const PROJECT_SCHEMA_VERSION = 4; // 3: forceSign, distance displacement; 4: files kept per test, 90° peel
export const GF_TO_N = 0.00980665;
export const DEFAULT_CONCENTRATION_M = 2.1;

export type Severity = 'info' | 'warning' | 'error';

export interface ParseIssue {
  severity: Severity;
  message: string;
  line?: number;
}

/** One numerical table (<DATA> ... <END DATA>) with its column headers. */
export interface DataTable {
  columns: string[];
  /** Column-major numeric data; columns[i] -> values[i]. */
  values: Float64Array[];
  rowCount: number;
  malformedRows: number;
}

/** One operation block: <INFO> + <Operation> + parameters + <DATA>. */
export interface OperationBlock {
  index: number;
  type: string; // e.g. "Wait", "Move Relative"
  info: Record<string, string>;
  params: Record<string, string>;
  data: DataTable | null;
  startLine: number;
}

export interface ParsedFile {
  fileId: string;
  path: string;
  name: string;
  sha256: string;
  sizeBytes: number;
  header: Record<string, string>;
  blocks: OperationBlock[];
  issues: ParseIssue[];
  unrecognizedSections: string[];
  status: 'ok' | 'warning' | 'error';
}

export type MetaSource = 'path' | 'filename' | 'file' | 'default' | 'user' | 'unknown';

export interface MetaField<T> {
  value: T | null;
  source: MetaSource;
}

export interface ExperimentMeta {
  chargeRatio: MetaField<number>;
  concentrationM: MetaField<number>;
  gel: MetaField<string>;
  substrate: MetaField<string>;
  nominalHoldS: MetaField<number>;
  repeat: MetaField<number>;
  baseName: string;
  notes: string[];
}

/** A movement cycle: a Move block paired with the hold (Wait) that preceded it. */
export interface Cycle {
  cycleId: string;
  fileId: string;
  cycleNumber: number;
  moveBlockIndex: number;
  holdBlockIndex: number | null;
  operation: string;
  holdTimeS: number | null;
  amplitudeMm: number | null;
  velocityMmS: number | null;
  stageAxis: string | null;
  date: string | null;
  time: string | null;
  timestamp: string | null;
  time_s: Float64Array;
  z_mm: Float64Array;
  force_gf: Float64Array;
  extra: Record<string, Float64Array>;
  holdTime_s: Float64Array | null;
  holdForce_gf: Float64Array | null;
  issues: ParseIssue[];
}

export type PeakMetric = 'min' | 'max' | 'absmax' | 'baselineMin';
export type ForceUnit = 'gf' | 'N';
/** 'positive': forces are displayed and exported with inverted sign, so adhesion is positive. */
export type ForceSign = 'positive' | 'recorded';
export type DisplacementMode = 'signed' | 'distance' | 'inverted';
export type BaselineMode = 'none' | 'holdMean' | 'moveInterval';
export type QCClass = 'green' | 'yellow' | 'orange' | 'red';
export type ExclusionRule = 'keepAll' | 'excludeRed' | 'excludeYellowUp';
export type GroupKey =
  | 'chargeRatio'
  | 'concentrationM'
  | 'gel'
  | 'substrate'
  | 'holdTimeS'
  | 'amplitudeMm'
  | 'velocityMmS';

export interface PointOutlierSettings {
  halfWindow: number;
  /** Minimum robust scale in gf. 0 = use the force resolution estimated from each cycle. */
  scaleFloorGf: number;
  zHalf: number;
  yellow: number;
  orange: number;
  red: number;
}

export interface CycleOutlierSettings {
  modZYellow: number;
  modZOrange: number;
  modZRed: number;
  minGroupSize: number;
  weakFraction: number;
  noPeakSteps: number;
  completeFraction: number;
  repeatDiffFraction: number;
  startOffsetMm: number;
  compareBy: GroupKey[];
}

/** Runs whose QC class is listed here are excluded from processed results unless kept manually. */
export interface RunExclusionSettings {
  excludeClasses: QCClass[];
}

export interface AnalysisSettings {
  peakMetric: PeakMetric;
  forceUnit: ForceUnit;
  forceSign: ForceSign;
  displacementMode: DisplacementMode;
  baselineMode: BaselineMode;
  baselineHoldLastS: number;
  baselineInterval: [number, number];
  point: PointOutlierSettings;
  cycle: CycleOutlierSettings;
  runExclusion: RunExclusionSettings;
  /** Advanced: automatic exclusion of individual points inside a run. */
  exclusionRule: ExclusionRule;
}

export interface MetaOverride {
  chargeRatio?: number | null;
  concentrationM?: number | null;
  gel?: string | null;
  substrate?: string | null;
  nominalHoldS?: number | null;
  repeat?: number | null;
}

export interface ManualExclusion {
  reason: string;
  at: string;
}

/** A manual decision about one run; it always wins over the automatic rule. */
export interface RunOverride {
  action: 'include' | 'exclude';
  reason: string;
  at: string;
}

export type RunStatus = 'included' | 'excludedAuto' | 'excludedManual' | 'keptManual';

export type AxisVar = string;

export interface GraphConfig {
  id: string;
  title: string;
  x: AxisVar;
  y: AxisVar;
  cycleIds: string[];
  hidden: string[];
  /** Marks each run's minimum force (▼). */
  showMarkers: boolean;
  /** Draw excluded runs as thin grey dashed lines (otherwise they are hidden). */
  showExcluded: boolean;
}

export type ViewMode = 'raw' | 'flagged' | 'processed' | 'compare';
export type MainTab = 'graph' | 'analysis' | 'compare' | 'settings' | 'files';

/** Step 2 of the sidebar: which experiment (charge ratio + concentration + substrate) and which TXT files are viewed. */
/**
 * Compare charge ratios tab: which data sets are compared. A data set is one
 * substrate × charge ratio × concentration. null = default (see the tab).
 */
export interface CompareSelection {
  /** Substrate names in lower case ("ss" and "SS" are the same). */
  substrates: string[] | null;
  chargeRatios: string[] | null;
  concentrations: string[] | null;
  holdTimes: string[] | null;
  /** Data set keys unticked in the list of matched sets. */
  hiddenSets: string[];
  /** Order of charge ratios inside each substrate panel. */
  order: 'desc' | 'asc';
  which: 'processed' | 'raw';
}

export interface ExperimentSelection {
  /** Values as shown in the dropdowns (null = first available). */
  chargeRatio: string | null;
  concentrationM: string | null;
  substrate: string | null;
  /** The main TXT file to view. */
  fileId: string | null;
  /** Overlay additional TXT files of the same experiment. */
  overlay: boolean;
  overlayFileIds: string[];
}

/** Which experimental method the interface shows. Each method has its own imported files. */
export type ExperimentMode = 'tack' | 'lapShear' | 'peel';
export const EXPERIMENT_MODES: ExperimentMode[] = ['tack', 'lapShear', 'peel'];

/* ---------------------------------------------------------------- Lap shear */

/** Bonded-joint geometry of one lap-shear run. Thickness is recorded but does not enter τ = F / (L × W). */
export interface LapShearDims {
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
}

/** Observed by the user on the specimen; never inferred from the curve. */
export type FailureMode = 'unspecified' | 'adhesive' | 'cohesive' | 'mixed';

export interface LapShearRunMeta extends LapShearDims {
  failureMode: FailureMode;
  /** Failure displacement picked by the user (mm); overrides the automatic criterion. */
  manualFailureMm: number | null;
}

export type IntegrationMode = 'full' | 'toPeak' | 'custom';

export interface LapShearSettings {
  integration: { mode: IntegrationMode; fromMm: number; toMm: number };
  /** Zero-force baseline from the first valid points, only when they pass the unloaded-region checks. */
  baseline: { enabled: boolean; points: number; maxSpreadGf: number };
  /** Complete failure: loading force below `fraction` × peak for `consecutive` valid points after the peak. */
  failure: { auto: boolean; fraction: number; consecutive: number };
  /** Sign of the loading force: detected from the data, or set by the user. */
  direction: 'auto' | 'negative' | 'positive';
  /** A time step longer than this multiple of the median step is a measurement gap and is not integrated across. */
  gapFactor: number;
  /** Dimensions given to runs that were never edited. */
  defaults: LapShearDims;
}

export type RunTab = 'graph' | 'results' | 'compare' | 'settings' | 'files';
export const RUN_TABS: RunTab[] = ['graph', 'results', 'compare', 'settings', 'files'];

/** Graph options of the Lap Shear and 90° Peel graphs. */
export interface RunGraphView {
  /** Always displacement (force vs time was removed in 1.7); kept for saved projects. */
  x: 'disp' | 'time';
  /** y axis: force (gf, N), stress = force / bonded area (kPa, MPa) or force per width (N/m, peel). */
  unit: 'gf' | 'N' | 'kPa' | 'MPa' | 'N/m';
  peakLabels: boolean;
  /** Area under the curve (lap shear: integration interval; peel: steady-state window). */
  shade: 'none' | 'highlight' | 'all';
  /** Run drawn bold while the others fade; null = all equal. */
  highlight: string | null;
  showRaw: boolean;
}

/** Compare charge ratios tab of Lap Shear and 90° Peel: which data sets and which property. */
export interface RunCompareSelection {
  substrates: string[] | null;
  chargeRatios: string[] | null;
  concentrations: string[] | null;
  holdTimes: string[] | null;
  hiddenSets: string[];
  order: 'desc' | 'asc';
  /** Property compared (key of the mode's property list). */
  metric: string;
}

export interface LapShearState {
  settings: LapShearSettings;
  /** Per-run dimensions, failure mode and manual failure point, keyed by cycleId. */
  runs: Record<string, LapShearRunMeta>;
  /** Runs shown on the graph and in the results (cycleIds). null = all valid runs. */
  selected: string[] | null;
  /** File whose runs are listed first in the sidebar. */
  fileId: string | null;
  view: RunGraphView;
  tab: RunTab;
  compare: RunCompareSelection;
  /** Lap-shear files the user unticked (by fileId). */
  disabledFiles: string[];
}

/* ---------------------------------------------------------------- 90° peel */

/** Gel strip of one peel run. Width enters peel strength and toughness; length is the bonded length. */
export interface PeelRunMeta {
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  /** Peel angle (°); Γ = F/w · (1 − cos θ), = F/w at 90°. */
  angleDeg: number;
  failureMode: FailureMode;
  /** Detachment (end of peeling) picked by hand (mm); overrides the automatic criterion. */
  manualDetachMm: number | null;
}

export interface PeelSettings {
  /** Steady-state (plateau) window used for the average peel force. */
  plateau: { mode: 'auto' | 'custom'; startFrac: number; endFrac: number; fromMm: number; toMm: number };
  integration: { mode: IntegrationMode; fromMm: number; toMm: number };
  baseline: { enabled: boolean; points: number; maxSpreadGf: number };
  /** Detachment: force below `fraction` × peak for `consecutive` points after the peak. */
  detach: { auto: boolean; fraction: number; consecutive: number };
  direction: 'auto' | 'negative' | 'positive';
  gapFactor: number;
  defaults: { lengthMm: number; widthMm: number; thicknessMm: number; angleDeg: number };
}

export interface PeelState {
  settings: PeelSettings;
  runs: Record<string, PeelRunMeta>;
  selected: string[] | null;
  fileId: string | null;
  view: RunGraphView;
  tab: RunTab;
  compare: RunCompareSelection;
  disabledFiles: string[];
}

export interface ProjectState {
  schemaVersion: number;
  name: string;
  settings: AnalysisSettings;
  overrides: Record<string, MetaOverride>;
  /** Keyed by cycleId. */
  runOverrides: Record<string, RunOverride>;
  /** Probe-tack files the user deselected: kept in the file list but left out of every calculation. */
  disabledFiles: string[];
  /** Legacy (schema 1): manual run exclusions. Converted to runOverrides by migrateState. */
  excludedCycles?: Record<string, ManualExclusion>;
  excludedPoints: Record<string, Record<string, ManualExclusion>>;
  graphs: GraphConfig[];
  activeGraphId: string;
  /** Legacy: graph view of version 1.x; no longer shown. */
  view: ViewMode;
  mainTab: MainTab;
  mode: ExperimentMode;
  lapShear: LapShearState;
  peel: PeelState;
  experiment: ExperimentSelection;
  compare: CompareSelection;
  selection: string[];
  groupBy: GroupKey[];
}

export interface SourceFileRecord {
  fileId: string;
  path: string;
  name: string;
  sha256: string;
  sizeBytes: number;
  /** Test the file was imported for (missing in projects saved before files were kept per test). */
  mode?: ExperimentMode;
}
