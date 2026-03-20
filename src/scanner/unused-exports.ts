/**
 * ts-unused-exports adapter — dead export detection.
 *
 * ts-unused-exports must be installed: npm install --save-dev ts-unused-exports
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UnusedExport {
  symbol: string;
  line: number;
}

export interface UnusedExportsResult {
  /** Map of file path → array of unused exports */
  files: Map<string, UnusedExport[]>;
  /** Total count of dead exports across all files */
  total: number;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run ts-unused-exports against the project's tsconfig and collect results.
 */
export function runUnusedExports(cwd: string): UnusedExportsResult | null {
  const tsconfig = path.join(cwd, 'tsconfig.json');
  if (!fs.existsSync(tsconfig)) {
    // Fall back to jsconfig.json
    const jsconfig = path.join(cwd, 'jsconfig.json');
    if (!fs.existsSync(jsconfig)) {
      logger.debug('No tsconfig.json or jsconfig.json found; skipping dead export detection');
      return null;
    }
  }

  const localBin = path.join(cwd, 'node_modules', '.bin', 'ts-unused-exports');
  const bin = fs.existsSync(localBin) ? localBin : 'ts-unused-exports';

  const result = spawnSync(
    bin,
    ['tsconfig.json', '--json'],
    { cwd, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }
  );

  if (result.status !== 0 && !result.stdout) {
    logger.warn('ts-unused-exports failed or not installed. Install with: npm install --save-dev ts-unused-exports');
    return null;
  }

  let raw: Record<string, Array<{ name: string; line: number }>>;
  try {
    raw = JSON.parse(result.stdout || '{}');
  } catch {
    logger.warn('Failed to parse ts-unused-exports output');
    return null;
  }

  return parseUnusedExports(raw, cwd);
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseUnusedExports(
  raw: Record<string, Array<{ name: string; line: number }>>,
  cwd: string
): UnusedExportsResult {
  const files = new Map<string, UnusedExport[]>();
  let total = 0;

  for (const [filePath, exports] of Object.entries(raw)) {
    const relative = path.relative(cwd, filePath);
    const unused: UnusedExport[] = exports.map(e => ({
      symbol: e.name,
      line: e.line,
    }));

    files.set(relative, unused);
    total += unused.length;
  }

  return { files, total };
}
