/**
 * Scanner orchestrator — runs all mechanical metric tools and assembles
 * a FileMetrics array ready for the scorer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import type {
  CodeHealthConfig,
  FileMetrics,
  FunctionMetrics,
  Smell,
  SmellType,
  CouplingMetrics,
  ModuleConfig,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { git, getChurn, getCurrentCommitShort } from '../utils/git.js';
import { runLizard, getFunctionSmells } from './lizard.js';
import { runJscpd } from './jscpd.js';
import { runMadge } from './madge.js';
import { runUnusedExports } from './unused-exports.js';
import { detectVersionedSymbols } from './versioned-symbols.js';
import { runCoverage, readExistingCoverage } from './coverage.js';
import type { VersionedSymbol, DriftSignals } from '../types/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScanResult {
  files: FileMetrics[];
  drift_signals: DriftSignals;
}

export interface ScanContext {
  config: CodeHealthConfig;
  cwd: string;
  /** If set, only scan these files (incremental mode) */
  targetFiles?: string[];
  skipCoverage?: boolean;
  skipLlm?: boolean;
  previousDeadExports?: number;
  /**
   * Quick mode: lizard only, changed files only, carry forward previous
   * metrics for unchanged files. Suitable for autoresearch iteration loops.
   */
  quick?: boolean;
  /** Previous snapshot's file metrics, used by quick mode. */
  previousFiles?: FileMetrics[];
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runScan(ctx: ScanContext): Promise<ScanResult> {
  if (ctx.quick) return runQuickScan(ctx);
  return runFullScan(ctx);
}

/**
 * Quick scan — lizard only, changed files only, carry forward previous
 * metrics for unchanged files. Designed for autoresearch iteration loops.
 */
async function runQuickScan(ctx: ScanContext): Promise<ScanResult> {
  const { config, cwd } = ctx;

  logger.step('Quick scan (lizard only, changed files)…');

  const allFiles   = await discoverFiles(config, cwd);
  const changedFiles = getChangedFilesSinceLastSnapshot(cwd, ctx.previousFiles ?? []);
  const targetFiles  = changedFiles.length > 0 ? changedFiles : allFiles;

  logger.dim(`  ${changedFiles.length} changed, ${allFiles.length - changedFiles.length} carried forward`);

  const lizardResults  = runLizard(targetFiles, cwd) ?? [];
  const lizardByFile   = new Map(lizardResults.map(r => [r.path, r]));
  const previousByFile = new Map((ctx.previousFiles ?? []).map(f => [f.path, f]));
  const commit         = getCurrentCommitShort(cwd);
  const files: FileMetrics[] = [];

  for (const filePath of allFiles) {
    const module = resolveModule(filePath, config.modules);
    if (!module) continue;

    // Carry forward unchanged files from previous snapshot
    if (!changedFiles.includes(filePath) && previousByFile.has(filePath)) {
      files.push(previousByFile.get(filePath)!);
      continue;
    }

    const lizard    = lizardByFile.get(filePath);
    const loc       = lizard?.loc ?? countLines(path.join(cwd, filePath));
    const cyclomatic = lizard?.cyclomatic ?? 0;
    const cognitive  = lizard?.cognitive  ?? 0;
    const churn30d   = getChurn(filePath, 30, cwd);

    // Carry forward slow metrics from previous snapshot if available
    const prev = previousByFile.get(filePath);
    const duplicationRatio = prev?.duplication_ratio ?? 0;
    const deadExports      = prev?.dead_exports      ?? 0;
    const coupling         = prev?.coupling          ?? { fan_in: 0, fan_out: 0 };
    const coverage         = prev?.coverage          ?? null;

    const smells   = buildFileSmells({ loc, cyclomatic, cognitive, duplicationRatio, coverage, churn30d, deadExports, fanOut: coupling.fan_out }, config.thresholds);
    const functions: FunctionMetrics[] = (lizard?.functions ?? []).map(fn => ({
      name:            fn.name,
      line_start:      fn.line_start,
      line_end:        fn.line_end,
      loc:             fn.loc,
      cyclomatic:      fn.cyclomatic,
      cognitive:       fn.cognitive,
      parameter_count: fn.parameter_count,
      coverage:        null,
      smells:          getFunctionSmells(fn, config.thresholds),
    }));

    files.push({
      path: filePath, module: module.label,
      health_score: 0, status: 'green',
      loc, coverage, cyclomatic, cognitive,
      duplication_ratio: duplicationRatio,
      churn_30d: churn30d, dead_exports: deadExports, coupling, smells, functions,
    });
  }

  return {
    files,
    drift_signals: { versioned_symbols: [], dead_export_growth: null },
  };
}

function getChangedFilesSinceLastSnapshot(cwd: string, previousFiles: FileMetrics[]): string[] {
  if (previousFiles.length === 0) return [];
  try {
    const output = git(['diff', '--name-only', 'HEAD~1', 'HEAD', '--', '*.js', '*.ts', '*.jsx', '*.tsx'], cwd);
    return output ? output.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function runFullScan(ctx: ScanContext): Promise<ScanResult> {
  const { config, cwd } = ctx;
  const t = config.thresholds;

  // ── 1. Discover JS/TS files ────────────────────────────────────────────────
  logger.step('Discovering source files…');
  const allFiles = await discoverFiles(config, cwd);
  const targetFiles = ctx.targetFiles
    ? ctx.targetFiles.filter(f => allFiles.includes(f))
    : allFiles;

  logger.dim(`  Found ${targetFiles.length} file(s) to scan`);

  if (targetFiles.length === 0) {
    return { files: [], drift_signals: { versioned_symbols: [], dead_export_growth: null } };
  }

  const commit = getCurrentCommitShort(cwd);

  // ── 2. Run mechanical tools ────────────────────────────────────────────────

  // Complexity + LOC (lizard)
  logger.step('Running complexity analysis (lizard)…');
  const lizardResults = runLizard(targetFiles, cwd) ?? [];
  const lizardByFile = new Map(lizardResults.map(r => [r.path, r]));

  // Duplication (jscpd)
  logger.step('Running duplication detection (jscpd)…');
  const jscpdResult = runJscpd(cwd, cwd);
  const dupByFile = jscpdResult?.files ?? new Map();

  // Coupling (madge)
  logger.step('Analysing import coupling (madge)…');
  const madgeResult = runMadge(cwd, cwd);
  const couplingByFile = madgeResult?.files ?? new Map();

  // Dead exports (ts-unused-exports)
  logger.step('Detecting dead exports…');
  const unusedResult = runUnusedExports(cwd);
  const unusedByFile = unusedResult?.files ?? new Map();

  // Coverage (optional)
  let coverageByFile = new Map<string, number>();
  if (config.dynamic_metrics.coverage && !ctx.skipCoverage) {
    logger.step('Collecting test coverage…');
    const coverageResult = runCoverage(config.dynamic_metrics.test_command, cwd);
    if (coverageResult) {
      for (const [file, cov] of coverageResult.files) {
        coverageByFile.set(file, cov.combined);
      }
    }
  } else {
    // Try to read existing coverage report without re-running tests
    const existing = readExistingCoverage(cwd);
    if (existing) {
      for (const [file, cov] of existing.files) {
        coverageByFile.set(file, cov.combined);
      }
    }
  }

  // ── 3. Churn (git log) ────────────────────────────────────────────────────
  logger.step('Computing churn metrics…');
  const churnByFile = new Map<string, number>();
  if (config.static_metrics.includes('churn')) {
    for (const file of targetFiles) {
      churnByFile.set(file, getChurn(file, 30, cwd));
    }
  }

  // ── 4. Versioned symbols ──────────────────────────────────────────────────
  logger.step('Detecting versioned symbols…');
  const versionedSymbols: VersionedSymbol[] = config.static_metrics.includes('versioned_symbols')
    ? detectVersionedSymbols(targetFiles, cwd, commit)
    : [];

  // ── 5. Assemble FileMetrics ───────────────────────────────────────────────
  logger.step('Assembling file metrics…');
  const files: FileMetrics[] = [];

  for (const filePath of targetFiles) {
    const module = resolveModule(filePath, config.modules);
    if (!module) continue; // outside all declared modules — skip

    const lizard = lizardByFile.get(filePath);
    const loc = lizard?.loc ?? countLines(path.join(cwd, filePath));
    const cyclomatic = lizard?.cyclomatic ?? 0;
    const cognitive = lizard?.cognitive ?? 0;
    const duplicationRatio = dupByFile.get(filePath) ?? 0;
    const coupling: CouplingMetrics = couplingByFile.get(filePath) ?? { fan_in: 0, fan_out: 0 };
    const deadExports = unusedByFile.get(filePath)?.length ?? 0;
    const coverage = coverageByFile.get(filePath) ?? null;
    const churn30d = churnByFile.get(filePath) ?? 0;

    // Build function-level metrics
    const functions: FunctionMetrics[] = (lizard?.functions ?? []).map(fn => ({
      name: fn.name,
      line_start: fn.line_start,
      line_end: fn.line_end,
      loc: fn.loc,
      cyclomatic: fn.cyclomatic,
      cognitive: fn.cognitive,
      parameter_count: fn.parameter_count,
      coverage: null, // function-level coverage requires additional tooling
      smells: getFunctionSmells(fn, t),
    }));

    // Build file-level smells
    const smells: Smell[] = buildFileSmells({
      loc, cyclomatic, cognitive, duplicationRatio, coverage, churn30d,
      deadExports, fanOut: coupling.fan_out,
    }, t);

    files.push({
      path: filePath,
      module: module.label,
      health_score: 0, // computed by scorer
      status: 'green', // computed by scorer
      loc,
      coverage,
      cyclomatic,
      cognitive,
      duplication_ratio: duplicationRatio,
      churn_30d: churn30d,
      dead_exports: deadExports,
      coupling,
      smells,
      functions,
    });
  }

  // ── 6. Drift signals ──────────────────────────────────────────────────────
  const currentDeadExports = unusedResult?.total ?? 0;
  const drift_signals: DriftSignals = {
    versioned_symbols: versionedSymbols,
    dead_export_growth: ctx.previousDeadExports != null
      ? {
          current: currentDeadExports,
          previous: ctx.previousDeadExports,
          delta: currentDeadExports - ctx.previousDeadExports,
          trend: currentDeadExports > ctx.previousDeadExports
            ? 'degrading'
            : currentDeadExports < ctx.previousDeadExports
              ? 'improving'
              : 'stable',
        }
      : null,
  };

  return { files, drift_signals };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function discoverFiles(config: CodeHealthConfig, cwd: string): Promise<string[]> {
  const patterns = config.modules
    .filter(m => !m.exclude_from_scoring)
    .map(m => `${m.path}**/*.{js,ts,jsx,tsx}`);

  const results = await glob(patterns, { cwd, ignore: ['**/node_modules/**', '**/dist/**'] });
  return results.sort();
}

function resolveModule(filePath: string, modules: ModuleConfig[]): ModuleConfig | null {
  // Longest matching path wins
  let best: ModuleConfig | null = null;
  for (const m of modules) {
    if (filePath.startsWith(m.path) && (!best || m.path.length > best.path.length)) {
      best = m;
    }
  }
  return best;
}

function countLines(absPath: string): number {
  try {
    const content = fs.readFileSync(absPath, 'utf8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

interface SmellInputs {
  loc: number;
  cyclomatic: number;
  cognitive: number;
  duplicationRatio: number;
  coverage: number | null;
  churn30d: number;
  deadExports: number;
  fanOut: number;
}

// ─── Declarative smell rules ──────────────────────────────────────────────────

interface SmellRule {
  type: SmellType;
  value: (m: SmellInputs) => number;
  warn: (t: CodeHealthConfig['thresholds']) => number;
  fail: (t: CodeHealthConfig['thresholds']) => number;
  detail: (value: number, failThreshold: number) => string;
}

const SMELL_RULES: SmellRule[] = [
  {
    type: 'high_complexity',
    value: m => m.loc,
    warn: t => t.loc_warn,
    fail: t => t.loc_fail,
    detail: (v, f) => `${v} lines, threshold ${f}`,
  },
  {
    type: 'high_complexity',
    value: m => m.cyclomatic,
    warn: t => t.cyclomatic_warn,
    fail: t => t.cyclomatic_fail,
    detail: (v, f) => `Cyclomatic complexity ${v}, threshold ${f}`,
  },
  {
    type: 'high_cognitive_complexity',
    value: m => m.cognitive,
    warn: t => t.cognitive_warn,
    fail: t => t.cognitive_fail,
    detail: (v, f) => `Cognitive complexity ${v}, threshold ${f}`,
  },
  {
    type: 'high_duplication',
    value: m => m.duplicationRatio,
    warn: t => t.duplication_warn,
    fail: t => t.duplication_fail,
    detail: (v, f) => `${Math.round(v * 100)}% duplicate blocks, threshold ${Math.round(f * 100)}%`,
  },
  {
    type: 'dead_export',
    value: m => m.deadExports,
    warn: t => t.dead_export_warn,
    fail: t => t.dead_export_fail,
    detail: (v, f) => `${v} unused exports, threshold ${f}`,
  },
  {
    type: 'high_fan_out',
    value: m => m.fanOut,
    warn: t => t.coupling_fan_out_warn,
    fail: t => t.coupling_fan_out_fail,
    detail: (v, f) => `Fan-out ${v}, threshold ${f}`,
  },
];

function evaluateRule(rule: SmellRule, metrics: SmellInputs, t: CodeHealthConfig['thresholds']): Smell | null {
  const value = rule.value(metrics);
  const failThreshold = rule.fail(t);
  if (value >= failThreshold) return { type: rule.type, severity: 'fail', detail: rule.detail(value, failThreshold) };
  if (value >= rule.warn(t))  return { type: rule.type, severity: 'warn', detail: rule.detail(value, failThreshold) };
  return null;
}

function buildFileSmells(
  metrics: SmellInputs,
  t: CodeHealthConfig['thresholds']
): Smell[] {
  const smells: Smell[] = SMELL_RULES
    .map(rule => evaluateRule(rule, metrics, t))
    .filter((s): s is Smell => s !== null);

  // Coverage is inverted (lower = worse) so handled separately
  if (metrics.coverage !== null) {
    const cov = Math.round(metrics.coverage * 100);
    if (metrics.coverage < t.coverage_fail) {
      smells.push({ type: 'low_coverage', severity: 'fail', detail: `${cov}% line coverage, threshold ${Math.round(t.coverage_fail * 100)}%` });
    } else if (metrics.coverage < t.coverage_warn) {
      smells.push({ type: 'low_coverage', severity: 'warn', detail: `${cov}% line coverage, threshold ${Math.round(t.coverage_warn * 100)}%` });
    }
  }

  // Compound: high churn + low coverage
  if (metrics.churn30d > 5 && metrics.coverage !== null && metrics.coverage < t.coverage_warn) {
    smells.push({
      type: 'high_churn_low_coverage',
      severity: 'warn',
      detail: `${metrics.churn30d} commits in 30d with only ${Math.round(metrics.coverage * 100)}% coverage`,
    });
  }

  return smells;
}
