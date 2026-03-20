/**
 * Health score computation — converts raw metrics into a [0,1] health score
 * per file, then aggregates to module level.
 */

import type {
  FileMetrics,
  ModuleMetrics,
  ModuleSignals,
  HealthStatus,
  Trend,
  CodeHealthConfig,
  ModuleConfig,
  SnapshotSummary,
} from '../types/index.js';

// ─── Signal weights ───────────────────────────────────────────────────────────

interface Weights {
  cyclomatic: number;
  cognitive: number;
  coverage: number;
  loc: number;
  duplication: number;
  churn_complexity: number;
}

const BASE_WEIGHTS: Weights = {
  cyclomatic: 0.25,
  cognitive: 0.20,
  coverage: 0.25,
  loc: 0.10,
  duplication: 0.10,
  churn_complexity: 0.10,
};

/** Redistribute coverage weight proportionally when coverage is disabled. */
function getWeights(coverageEnabled: boolean): Weights {
  if (coverageEnabled) return BASE_WEIGHTS;

  const w = { ...BASE_WEIGHTS };
  const coverageWeight = w.coverage;
  w.coverage = 0;

  // Redistribute proportionally across other signals
  const remainder = 1 - coverageWeight;
  w.cyclomatic = (w.cyclomatic / remainder);
  w.cognitive = (w.cognitive / remainder);
  w.loc = (w.loc / remainder);
  w.duplication = (w.duplication / remainder);
  w.churn_complexity = (w.churn_complexity / remainder);

  return w;
}

// ─── File-level scoring ───────────────────────────────────────────────────────

/**
 * Compute health_score and status for a single file.
 * Mutates the FileMetrics object in place.
 */
export function scoreFile(file: FileMetrics, config: CodeHealthConfig): FileMetrics {
  const t = config.thresholds;
  const coverageEnabled = config.dynamic_metrics.coverage && file.coverage !== null;
  const w = getWeights(coverageEnabled);

  let totalPenalty = 0;

  // Cyclomatic complexity penalty
  totalPenalty += linearPenalty(
    file.cyclomatic,
    t.cyclomatic_warn,
    t.cyclomatic_fail,
    w.cyclomatic
  );

  // Cognitive complexity penalty
  totalPenalty += linearPenalty(
    file.cognitive,
    t.cognitive_warn,
    t.cognitive_fail,
    w.cognitive
  );

  // Coverage penalty (inverted — lower coverage = more penalty)
  if (coverageEnabled && file.coverage !== null) {
    totalPenalty += linearPenalty(
      1 - file.coverage,        // invert: penalty grows as coverage shrinks
      1 - t.coverage_warn,
      1 - t.coverage_fail,
      w.coverage
    );
  }

  // LOC penalty
  totalPenalty += linearPenalty(file.loc, t.loc_warn, t.loc_fail, w.loc);

  // Duplication penalty
  totalPenalty += linearPenalty(
    file.duplication_ratio,
    t.duplication_warn,
    t.duplication_fail,
    w.duplication
  );

  // Churn × complexity compound penalty
  // Normalise churn to [0, 1] over a 30-commit window
  const normalisedChurn = Math.min(file.churn_30d / 30, 1);
  const normalisedCyclomatic = Math.min(file.cyclomatic / t.cyclomatic_fail, 1);
  const churnComplexityScore = normalisedChurn * normalisedCyclomatic;
  totalPenalty += churnComplexityScore * w.churn_complexity;

  const health_score = Math.max(0, Math.min(1, 1 - totalPenalty));

  return {
    ...file,
    health_score: round2(health_score),
    status: scoreToStatus(health_score),
  };
}

/**
 * Score all files in place and return them.
 */
export function scoreFiles(files: FileMetrics[], config: CodeHealthConfig): FileMetrics[] {
  return files.map(f => scoreFile(f, config));
}

// ─── Module-level aggregation ─────────────────────────────────────────────────

export function aggregateModules(
  files: FileMetrics[],
  config: CodeHealthConfig,
  previousModules?: ModuleMetrics[]
): ModuleMetrics[] {
  const moduleConfigs = config.modules.filter(m => !m.exclude_from_scoring);
  const modules: ModuleMetrics[] = [];

  for (const moduleConfig of moduleConfigs) {
    const moduleFiles = files.filter(f => f.module === moduleConfig.label);
    if (moduleFiles.length === 0) continue;

    const module = aggregateModule(moduleFiles, moduleConfig, previousModules);
    modules.push(module);
  }

  return modules;
}

function aggregateModule(
  files: FileMetrics[],
  config: ModuleConfig,
  previousModules?: ModuleMetrics[]
): ModuleMetrics {
  const scores = files.map(f => f.health_score);
  const health_score = round2(mean(scores));

  const prev = previousModules?.find(m => m.name === config.label);
  const trend_delta = prev ? round2(health_score - prev.health_score) : 0;
  const trend = deltaToTrend(trend_delta);

  const signals = computeModuleSignals(files);

  return {
    name: config.label,
    path: config.path,
    health_score,
    status: scoreToStatus(health_score),
    trend,
    trend_delta,
    plain_summary: null, // filled in by LLM synthesis pass
    signals,
  };
}

function computeModuleSignals(files: FileMetrics[]): ModuleSignals {
  const cyclomatics = files.map(f => f.cyclomatic).sort((a, b) => a - b);
  const cognitives = files.map(f => f.cognitive).sort((a, b) => a - b);
  const coverageValues = files.map(f => f.coverage).filter((c): c is number => c !== null);
  const fanOuts = files.map(f => f.coupling.fan_out);

  return {
    loc: files.reduce((sum, f) => sum + f.loc, 0),
    coverage: coverageValues.length > 0 ? round2(mean(coverageValues)) : null,
    cyclomatic_p50: percentile(cyclomatics, 50),
    cyclomatic_p95: percentile(cyclomatics, 95),
    cognitive_p95: percentile(cognitives, 95),
    duplication_ratio: round2(mean(files.map(f => f.duplication_ratio))),
    churn_30d: files.reduce((sum, f) => sum + f.churn_30d, 0),
    dead_exports: files.reduce((sum, f) => sum + f.dead_exports, 0),
    coupling_fan_out_avg: round2(mean(fanOuts)),
  };
}

// ─── Snapshot summary ─────────────────────────────────────────────────────────

export function computeSummary(
  files: FileMetrics[],
  modules: ModuleMetrics[],
  previousSummary?: SnapshotSummary
): SnapshotSummary {
  const scores = files.map(f => f.health_score);
  const health_score = scores.length > 0 ? round2(mean(scores)) : 1;

  const trend_delta = previousSummary ? round2(health_score - previousSummary.health_score) : 0;
  const trend = deltaToTrend(trend_delta);

  const coverageValues = files.map(f => f.coverage).filter((c): c is number => c !== null);

  return {
    health_score,
    trend,
    trend_delta,
    coverage: coverageValues.length > 0 ? round2(mean(coverageValues)) : null,
    total_loc: files.reduce((sum, f) => sum + f.loc, 0),
    files_analysed: files.length,
    red_files: files.filter(f => f.status === 'red').length,
    amber_files: files.filter(f => f.status === 'amber').length,
    green_files: files.filter(f => f.status === 'green').length,
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Linear penalty between warn and fail thresholds, capped at maxWeight.
 * Returns 0 below warn, maxWeight at or above fail.
 */
function linearPenalty(value: number, warn: number, fail: number, maxWeight: number): number {
  if (value <= warn) return 0;
  if (value >= fail) return maxWeight;
  return maxWeight * ((value - warn) / (fail - warn));
}

export function scoreToStatus(score: number): HealthStatus {
  if (score >= 0.75) return 'green';
  if (score >= 0.50) return 'amber';
  return 'red';
}

export function deltaToTrend(delta: number): Trend {
  if (delta > 0.02) return 'improving';
  if (delta < -0.02) return 'degrading';
  return 'stable';
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))]!;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
