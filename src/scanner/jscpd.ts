/**
 * jscpd adapter — duplicate code block detection.
 *
 * jscpd must be installed as a dev dependency or globally:
 *   npm install --save-dev jscpd
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DuplicationResult {
  /** Map of file path → duplication ratio (0–1) */
  files: Map<string, number>;
  /** Overall project duplication ratio */
  overall: number;
}

interface JscpdReport {
  statistics: {
    total: {
      clones: number;
      duplicatedLines: number;
      percentage: number;
    };
    formats: Record<string, {
      total: {
        clones: number;
        duplicatedLines: number;
        percentage: number;
        lines: number;
      };
    }>;
  };
  duplicates: Array<{
    format: string;
    lines: number;
    tokens: number;
    firstFile: { name: string; start: number; end: number };
    secondFile: { name: string; start: number; end: number };
  }>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run jscpd on the given directory and return per-file duplication ratios.
 */
export function runJscpd(targetDir: string, cwd: string): DuplicationResult | null {
  // Resolve jscpd binary (local node_modules preferred)
  const localBin = path.join(cwd, 'node_modules', '.bin', 'jscpd');
  const bin = fs.existsSync(localBin) ? localBin : 'jscpd';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-jscpd-'));
  const reportFile = path.join(tmpDir, 'jscpd.json');

  const result = spawnSync(
    bin,
    [
      targetDir,
      '--format', 'javascript,typescript',
      '--reporters', 'json',
      '--output', tmpDir,
      '--silent',
      '--min-tokens', '50',
    ],
    { cwd, encoding: 'utf8' }
  );

  if (!fs.existsSync(reportFile)) {
    if (result.status !== 0) {
      logger.warn('jscpd failed or not installed. Install with: npm install --save-dev jscpd');
    }
    return null;
  }

  const raw = fs.readFileSync(reportFile, 'utf8');
  const report: JscpdReport = JSON.parse(raw);

  return parseJscpdReport(report, cwd);
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseJscpdReport(report: JscpdReport, cwd: string): DuplicationResult {
  const fileDupLines = new Map<string, { duplicated: number; total: number }>();

  // Accumulate duplicated lines per file from clone pairs
  for (const dup of report.duplicates) {
    const file1 = path.relative(cwd, dup.firstFile.name);
    const file2 = path.relative(cwd, dup.secondFile.name);
    const lines = dup.lines;

    addFileDup(fileDupLines, file1, lines);
    addFileDup(fileDupLines, file2, lines);
  }

  // Compute per-file ratios (duplicated lines / total lines for file)
  // Total LOC is estimated from jscpd format stats — ideally from lizard
  const files = new Map<string, number>();
  for (const [filePath, counts] of fileDupLines) {
    if (counts.total > 0) {
      files.set(filePath, Math.min(counts.duplicated / counts.total, 1));
    }
  }

  const overall = (report.statistics.total.percentage ?? 0) / 100;

  return { files, overall };
}

function addFileDup(
  map: Map<string, { duplicated: number; total: number }>,
  file: string,
  lines: number
): void {
  const existing = map.get(file) ?? { duplicated: 0, total: 0 };
  existing.duplicated += lines;
  existing.total = Math.max(existing.total, lines); // rough lower bound; will be improved by LOC from lizard
  map.set(file, existing);
}

// ─── Merge with LOC data ──────────────────────────────────────────────────────

/**
 * Refine duplication ratios using actual LOC from lizard results.
 */
export function refineDuplicationRatios(
  result: DuplicationResult,
  locByFile: Map<string, number>
): DuplicationResult {
  const refined = new Map<string, number>();

  for (const [file, ratio] of result.files) {
    const loc = locByFile.get(file);
    if (loc && loc > 0) {
      // ratio was duplicatedLines / (estimated total); recalculate with real LOC
      const dupLines = ratio * (loc / 2); // conservative estimate
      refined.set(file, Math.min(dupLines / loc, 1));
    } else {
      refined.set(file, ratio);
    }
  }

  return { files: refined, overall: result.overall };
}
