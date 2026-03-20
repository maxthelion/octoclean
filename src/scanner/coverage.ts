/**
 * Coverage adapter — reads c8 / nyc JSON coverage reports.
 *
 * Coverage collection is opt-in. When enabled, the configured test_command
 * is run and we read the resulting coverage-summary.json.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileCoverage {
  lines: number;   // 0–1
  branches: number; // 0–1
  combined: number; // weighted average
}

export interface CoverageResult {
  files: Map<string, FileCoverage>;
  overall: FileCoverage;
}

// c8 / nyc coverage-summary.json shape
interface CoverageSummaryFile {
  lines: { total: number; covered: number; pct: number };
  branches: { total: number; covered: number; pct: number };
  functions: { total: number; covered: number; pct: number };
  statements: { total: number; covered: number; pct: number };
}

type CoverageSummaryJson = Record<string, CoverageSummaryFile>;

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run the test command with c8 and parse the resulting coverage report.
 */
export function runCoverage(testCommand: string, cwd: string): CoverageResult | null {
  logger.step(`Running coverage: ${testCommand}`);

  const result = spawnSync(testCommand, {
    cwd,
    encoding: 'utf8',
    shell: true,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    logger.warn('Test command failed; coverage data unavailable');
    return null;
  }

  // Look for coverage-summary.json in standard locations
  const candidates = [
    path.join(cwd, 'coverage', 'coverage-summary.json'),
    path.join(cwd, '.nyc_output', 'coverage-summary.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return parseCoverageSummary(candidate, cwd);
    }
  }

  logger.warn('No coverage-summary.json found. Ensure c8 or nyc is configured with JSON reporter.');
  return null;
}

/**
 * Read an already-existing coverage-summary.json without re-running tests.
 * Used for incremental scans where coverage was already collected.
 */
export function readExistingCoverage(cwd: string): CoverageResult | null {
  const candidates = [
    path.join(cwd, 'coverage', 'coverage-summary.json'),
    path.join(cwd, '.nyc_output', 'coverage-summary.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return parseCoverageSummary(candidate, cwd);
    }
  }

  return null;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseCoverageSummary(summaryPath: string, cwd: string): CoverageResult {
  const raw: CoverageSummaryJson = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const files = new Map<string, FileCoverage>();

  for (const [absPath, data] of Object.entries(raw)) {
    if (absPath === 'total') continue;

    const relPath = path.relative(cwd, absPath);
    const lines = data.lines.pct / 100;
    const branches = data.branches.pct / 100;
    const combined = (lines * 0.6 + branches * 0.4); // weight lines slightly higher

    files.set(relPath, { lines, branches, combined });
  }

  const totalData = raw['total'];
  const overall: FileCoverage = totalData
    ? {
        lines: totalData.lines.pct / 100,
        branches: totalData.branches.pct / 100,
        combined: (totalData.lines.pct * 0.6 + totalData.branches.pct * 0.4) / 100,
      }
    : { lines: 0, branches: 0, combined: 0 };

  return { files, overall };
}
