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
  CouplingMetrics,
  ModuleConfig,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { getChurn, getCurrentCommitShort } from '../utils/git.js';
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
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runScan(ctx: ScanContext): Promise<ScanResult> {
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

function buildFileSmells(
  metrics: SmellInputs,
  t: CodeHealthConfig['thresholds']
): Smell[] {
  const smells: Smell[] = [];

  if (metrics.loc >= t.loc_fail) {
    smells.push({ type: 'high_complexity', severity: 'fail', detail: `${metrics.loc} lines, threshold ${t.loc_fail}` });
  } else if (metrics.loc >= t.loc_warn) {
    smells.push({ type: 'high_complexity', severity: 'warn', detail: `${metrics.loc} lines, threshold ${t.loc_fail}` });
  }

  if (metrics.cyclomatic >= t.cyclomatic_fail) {
    smells.push({ type: 'high_complexity', severity: 'fail', detail: `Cyclomatic complexity ${metrics.cyclomatic}, threshold ${t.cyclomatic_fail}` });
  } else if (metrics.cyclomatic >= t.cyclomatic_warn) {
    smells.push({ type: 'high_complexity', severity: 'warn', detail: `Cyclomatic complexity ${metrics.cyclomatic}, threshold ${t.cyclomatic_fail}` });
  }

  if (metrics.cognitive >= t.cognitive_fail) {
    smells.push({ type: 'high_cognitive_complexity', severity: 'fail', detail: `Cognitive complexity ${metrics.cognitive}, threshold ${t.cognitive_fail}` });
  } else if (metrics.cognitive >= t.cognitive_warn) {
    smells.push({ type: 'high_cognitive_complexity', severity: 'warn', detail: `Cognitive complexity ${metrics.cognitive}, threshold ${t.cognitive_fail}` });
  }

  if (metrics.duplicationRatio >= t.duplication_fail) {
    smells.push({ type: 'high_duplication', severity: 'fail', detail: `${Math.round(metrics.duplicationRatio * 100)}% duplicate blocks, threshold ${Math.round(t.duplication_fail * 100)}%` });
  } else if (metrics.duplicationRatio >= t.duplication_warn) {
    smells.push({ type: 'high_duplication', severity: 'warn', detail: `${Math.round(metrics.duplicationRatio * 100)}% duplicate blocks, threshold ${Math.round(t.duplication_fail * 100)}%` });
  }

  if (metrics.coverage !== null) {
    if (metrics.coverage < t.coverage_fail) {
      smells.push({ type: 'low_coverage', severity: 'fail', detail: `${Math.round(metrics.coverage * 100)}% line coverage, threshold ${Math.round(t.coverage_fail * 100)}%` });
    } else if (metrics.coverage < t.coverage_warn) {
      smells.push({ type: 'low_coverage', severity: 'warn', detail: `${Math.round(metrics.coverage * 100)}% line coverage, threshold ${Math.round(t.coverage_warn * 100)}%` });
    }
  }

  if (metrics.deadExports >= t.dead_export_fail) {
    smells.push({ type: 'dead_export', severity: 'fail', detail: `${metrics.deadExports} unused exports, threshold ${t.dead_export_fail}` });
  } else if (metrics.deadExports >= t.dead_export_warn) {
    smells.push({ type: 'dead_export', severity: 'warn', detail: `${metrics.deadExports} unused exports, threshold ${t.dead_export_fail}` });
  }

  if (metrics.fanOut >= t.coupling_fan_out_fail) {
    smells.push({ type: 'high_fan_out', severity: 'fail', detail: `Fan-out ${metrics.fanOut}, threshold ${t.coupling_fan_out_fail}` });
  } else if (metrics.fanOut >= t.coupling_fan_out_warn) {
    smells.push({ type: 'high_fan_out', severity: 'warn', detail: `Fan-out ${metrics.fanOut}, threshold ${t.coupling_fan_out_fail}` });
  }

  // Compound smell: high churn + low coverage
  if (metrics.churn30d > 5 && metrics.coverage !== null && metrics.coverage < t.coverage_warn) {
    smells.push({
      type: 'high_churn_low_coverage',
      severity: 'warn',
      detail: `${metrics.churn30d} commits in 30d with only ${Math.round(metrics.coverage * 100)}% coverage`,
    });
  }

  return smells;
}
