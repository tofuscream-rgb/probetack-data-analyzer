/** Shared data types. Raw measurement arrays are never mutated after parsing. */

export const APP_VERSION = '1.2.0';
/** Bump whenever a calculation, scoring rule or default changes results. */
export const ALGORITHM_VERSION = '1.1.0';
/** 2: per-run overrides (runOverrides) replace excludedCycles; older projects are migrated on load. */
export const PROJECT_SCHEMA_VERSION = 2;
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

export interface ProjectState {
  schemaVersion: number;
  name: string;
  settings: AnalysisSettings;
  overrides: Record<string, MetaOverride>;
  /** Keyed by cycleId. */
  runOverrides: Record<string, RunOverride>;
  /** Legacy (schema 1): manual run exclusions. Converted to runOverrides by migrateState. */
  excludedCycles?: Record<string, ManualExclusion>;
  excludedPoints: Record<string, Record<string, ManualExclusion>>;
  graphs: GraphConfig[];
  activeGraphId: string;
  /** Legacy: graph view of version 1.x; no longer shown. */
  view: ViewMode;
  mainTab: MainTab;
  experiment: ExperimentSelection;
  selection: string[];
  groupBy: GroupKey[];
}

export interface SourceFileRecord {
  fileId: string;
  path: string;
  name: string;
  sha256: string;
  sizeBytes: number;
}
