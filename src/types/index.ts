// ─── Core domain types derived from the CodeHealth v1 spec ───────────────────

export type HealthStatus = 'green' | 'amber' | 'red';
export type Trend = 'improving' | 'stable' | 'degrading';
export type Severity = 'ok' | 'warn' | 'fail';

// ─── Config ──────────────────────────────────────────────────────────────────

export type SamplingStrategy = 'merges-to-main' | 'weekly' | 'every-commit';

export interface ModuleConfig {
  path: string;
  label: string;
  exclude_from_scoring?: boolean;
}

export interface ThresholdConfig {
  loc_warn: number;
  loc_fail: number;
  function_loc_warn: number;
  function_loc_fail: number;
  cyclomatic_warn: number;
  cyclomatic_fail: number;
  cognitive_warn: number;
  cognitive_fail: number;
  duplication_warn: number;
  duplication_fail: number;
  parameter_count_warn: number;
  parameter_count_fail: number;
  coverage_warn: number;
  coverage_fail: number;
  coupling_fan_out_warn: number;
  coupling_fan_out_fail: number;
  dead_export_warn: number;
  dead_export_fail: number;
}

export type StaticMetricKey =
  | 'loc'
  | 'cyclomatic'
  | 'cognitive'
  | 'duplication'
  | 'dead_exports'
  | 'churn'
  | 'coupling'
  | 'versioned_symbols';

export type RemediationAction =
  | 'rename_symbol'
  | 'extract_function'
  | 'consolidate_duplicate'
  | 'update_docstring'
  | 'remove_dead_export'
  | 'change_interface'
  | 'modify_exports'
  | 'alter_data_structure';

export interface RemediationConfig {
  enabled: boolean;
  branch_prefix: string;
  max_files_per_night: number;
  quarantine_after_failures: number;
  scope: {
    allow: RemediationAction[];
    deny: RemediationAction[];
  };
}

export interface LlmConfig {
  enabled: boolean;
  model_file: string;
  model_synthesis: string;
  min_confidence_to_act: number;
  max_files_per_night: number;
}

export interface DynamicMetricsConfig {
  coverage: boolean;
  test_command: string;
}

export interface CodeHealthConfig {
  version: 1;
  sampling: SamplingStrategy;
  history_depth: number;
  main_branch: string;
  static_metrics: StaticMetricKey[];
  dynamic_metrics: DynamicMetricsConfig;
  llm_assessments: LlmConfig;
  thresholds: ThresholdConfig;
  modules: ModuleConfig[];
  remediation: RemediationConfig;
}

// ─── Smells ──────────────────────────────────────────────────────────────────

export type SmellType =
  | 'high_complexity'
  | 'high_cognitive_complexity'
  | 'low_coverage'
  | 'high_duplication'
  | 'giant_function'
  | 'too_many_parameters'
  | 'dead_export'
  | 'high_churn_low_coverage'
  | 'high_fan_out'
  | 'versioned_symbol';

export interface Smell {
  type: SmellType;
  severity: Severity;
  detail: string;
}

// ─── Function-level metrics ───────────────────────────────────────────────────

export interface FunctionMetrics {
  name: string;
  line_start: number;
  line_end: number;
  loc: number;
  cyclomatic: number;
  cognitive: number;
  parameter_count: number;
  coverage: number | null;
  smells: Smell[];
}

// ─── File-level metrics ───────────────────────────────────────────────────────

export interface CouplingMetrics {
  fan_in: number;
  fan_out: number;
}

export interface FileMetrics {
  path: string;
  module: string;
  health_score: number;
  status: HealthStatus;
  loc: number;
  coverage: number | null;
  cyclomatic: number;
  cognitive: number;
  duplication_ratio: number;
  churn_30d: number;
  dead_exports: number;
  coupling: CouplingMetrics;
  smells: Smell[];
  functions: FunctionMetrics[];
}

// ─── Module-level metrics ─────────────────────────────────────────────────────

export interface ModuleSignals {
  loc: number;
  coverage: number | null;
  cyclomatic_p50: number;
  cyclomatic_p95: number;
  cognitive_p95: number;
  duplication_ratio: number;
  churn_30d: number;
  dead_exports: number;
  coupling_fan_out_avg: number;
}

export interface ModuleMetrics {
  name: string;
  path: string;
  health_score: number;
  status: HealthStatus;
  trend: Trend;
  trend_delta: number;
  plain_summary: string | null;
  signals: ModuleSignals;
}

// ─── Drift signals ────────────────────────────────────────────────────────────

export interface VersionedSymbol {
  name: string;
  file: string;
  introduced_commit: string;
  severity: Severity;
}

export interface DeadExportGrowth {
  current: number;
  previous: number;
  delta: number;
  trend: Trend;
}

export interface DriftSignals {
  versioned_symbols: VersionedSymbol[];
  dead_export_growth: DeadExportGrowth | null;
}

// ─── LLM assessments ─────────────────────────────────────────────────────────

export type AssessmentType =
  | 'docstring_faithfulness'
  | 'naming_coherence'
  | 'competing_implementation'
  | 'intent_clarity';

export interface Assessment {
  type: AssessmentType;
  score: number;       // 0–1
  confidence: number;  // 0–1
  severity: Severity;
  detail: string;
  lines_of_concern?: number[];
  related_files?: string[];
}

export interface FileAssessments {
  path: string;
  assessments: Assessment[];
}

export interface AgentAssessments {
  generated_at: string;
  model: string;
  prompt_version: string;
  files: FileAssessments[];
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

export interface SnapshotSummary {
  health_score: number;
  trend: Trend;
  trend_delta: number;
  coverage: number | null;
  total_loc: number;
  files_analysed: number;
  red_files: number;
  amber_files: number;
  green_files: number;
}

export interface Snapshot {
  schema_version: 1;
  generated_at: string;
  commit: string;
  commit_message: string;
  repo: string;
  summary: SnapshotSummary;
  modules: ModuleMetrics[];
  files: FileMetrics[];
  drift_signals: DriftSignals;
  agent_assessments: AgentAssessments | null;
}

// ─── Index file ───────────────────────────────────────────────────────────────

export interface IndexEntry {
  timestamp: string;
  commit: string;
  file: string;
  summary: Pick<SnapshotSummary, 'health_score' | 'trend' | 'red_files' | 'amber_files' | 'green_files'>;
}

export interface IndexFile {
  schema_version: 1;
  repo: string;
  latest: string;
  snapshots: IndexEntry[];
}

// ─── Quarantine ───────────────────────────────────────────────────────────────

export interface QuarantineEntry {
  path: string;
  failures: number;
  last_attempt: string;
  last_action: RemediationAction;
  reason: string;
  quarantined_until: string;
}

export interface QuarantineStore {
  entries: Record<string, QuarantineEntry>;
}

// ─── Scan options (CLI → pipeline) ───────────────────────────────────────────

export interface ScanOptions {
  commits?: number;
  since?: string;
  ref?: string;
  pushMetrics: boolean;
  noLlm: boolean;
  noDynamic: boolean;
  output?: string;
}

export interface AssessOptions {
  file?: string;
  module?: string;
  force: boolean;
}

export interface ReportOptions {
  module?: string;
  format: 'text' | 'json' | 'markdown';
  worst?: number;
  agent: boolean;
}

export interface RemediateOptions {
  dryRun: boolean;
  file?: string;
  max?: number;
}

export interface ServeOptions {
  port: number;
  open: boolean;
}

export interface DiffOptions {
  from: string;
  to: string;
}
