/**
 * Lizard adapter — cyclomatic complexity, cognitive complexity, LOC, parameter count.
 *
 * Lizard is a Python tool. Install with: pip install lizard
 * We invoke it via subprocess and parse its CSV/JSON output.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import type { FunctionMetrics, Smell } from '../types/index.js';
import type { ThresholdConfig } from '../types/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LizardFunctionResult {
  name: string;
  line_start: number;
  line_end: number;
  loc: number;
  cyclomatic: number;
  cognitive: number;
  parameter_count: number;
}

export interface LizardFileResult {
  path: string;
  loc: number;
  cyclomatic: number;
  cognitive: number;
  functions: LizardFunctionResult[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run lizard on a list of files and return structured results.
 * Returns null if lizard is not installed.
 */
export function runLizard(files: string[], cwd: string): LizardFileResult[] | null {
  // Check lizard is available
  const check = spawnSync('lizard', ['--version'], { encoding: 'utf8' });
  if (check.status !== 0) {
    logger.warn('lizard not found. Install with: pip install lizard');
    return null;
  }

  if (files.length === 0) return [];

  // Run lizard with XML output for reliable parsing
  const result = spawnSync(
    'lizard',
    ['--xml', '--length', '--languages', 'javascript,typescript', ...files],
    { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );

  if (result.status !== 0 && !result.stdout) {
    logger.warn(`lizard exited with status ${result.status}`);
    return null;
  }

  return parseLizardXml(result.stdout, cwd);
}

// ─── XML parser ───────────────────────────────────────────────────────────────

/**
 * Parse lizard's XML output into structured results.
 *
 * Lizard XML schema (simplified):
 * <codeanalysis>
 *   <measure type="Function">
 *     <item name="fnName@line file">
 *       <value>LOC</value>
 *       <value>cyclomatic</value>
 *       <value>param_count</value>
 *       <value>line_start</value>
 *       <value>file_path</value>
 *     </item>
 *   </measure>
 * </codeanalysis>
 *
 * Note: lizard does not natively compute cognitive complexity —
 * we estimate it from cyclomatic as a placeholder until a native
 * cognitive metric is available or we switch to a TS-AST based approach.
 */
function parseLizardXml(xml: string, cwd: string): LizardFileResult[] {
  const fileMap = new Map<string, LizardFileResult>();

  // Extract function-level items using regex (avoids XML parser dependency)
  const itemPattern = /<item name="([^"]+)">([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml)) !== null) {
    const nameField = match[1]!;
    const valuesXml = match[2]!;

    const values = [...valuesXml.matchAll(/<value>([^<]*)<\/value>/g)].map(m => m[1]!.trim());
    if (values.length < 5) continue;

    const [locStr, cyclomaticStr, paramCountStr, lineStartStr, filePathRaw] = values;
    const filePath = path.relative(cwd, filePathRaw!.trim());

    const loc = parseInt(locStr!, 10);
    const cyclomatic = parseInt(cyclomaticStr!, 10);
    const paramCount = parseInt(paramCountStr!, 10);
    const lineStart = parseInt(lineStartStr!, 10);

    // Extract function name from "fnName@line file" format
    const fnName = nameField.split('@')[0]!.trim();

    if (!fileMap.has(filePath)) {
      fileMap.set(filePath, {
        path: filePath,
        loc: 0,
        cyclomatic: 0,
        cognitive: 0,
        functions: [],
      });
    }

    const fileResult = fileMap.get(filePath)!;
    fileResult.functions.push({
      name: fnName,
      line_start: lineStart,
      line_end: lineStart + loc - 1,
      loc,
      cyclomatic,
      cognitive: estimateCognitive(cyclomatic), // placeholder
      parameter_count: paramCount,
    });
  }

  // Aggregate file-level metrics from functions
  for (const file of fileMap.values()) {
    if (file.functions.length > 0) {
      file.loc = file.functions.reduce((sum, f) => sum + f.loc, 0);
      file.cyclomatic = Math.max(...file.functions.map(f => f.cyclomatic));
      file.cognitive = Math.max(...file.functions.map(f => f.cognitive));
    }
  }

  return [...fileMap.values()];
}

/**
 * Rough cognitive complexity estimate from cyclomatic.
 * Replace with proper AST-based measurement in a future iteration.
 */
function estimateCognitive(cyclomatic: number): number {
  // Cognitive is generally higher than cyclomatic; use 1.3× heuristic
  return Math.round(cyclomatic * 1.3);
}

// ─── Smell detection ──────────────────────────────────────────────────────────

export function getFunctionSmells(fn: LizardFunctionResult, t: ThresholdConfig): Smell[] {
  const smells: Smell[] = [];

  if (fn.loc >= t.function_loc_fail) {
    smells.push({
      type: 'giant_function',
      severity: 'fail',
      detail: `${fn.loc} lines, threshold ${t.function_loc_fail} fail`,
    });
  } else if (fn.loc >= t.function_loc_warn) {
    smells.push({
      type: 'giant_function',
      severity: 'warn',
      detail: `${fn.loc} lines, threshold ${t.function_loc_fail} fail`,
    });
  }

  if (fn.cyclomatic >= t.cyclomatic_fail) {
    smells.push({
      type: 'high_complexity',
      severity: 'fail',
      detail: `Cyclomatic complexity ${fn.cyclomatic}, threshold ${t.cyclomatic_fail}`,
    });
  } else if (fn.cyclomatic >= t.cyclomatic_warn) {
    smells.push({
      type: 'high_complexity',
      severity: 'warn',
      detail: `Cyclomatic complexity ${fn.cyclomatic}, threshold ${t.cyclomatic_fail}`,
    });
  }

  if (fn.cognitive >= t.cognitive_fail) {
    smells.push({
      type: 'high_cognitive_complexity',
      severity: 'fail',
      detail: `Cognitive complexity ${fn.cognitive}, threshold ${t.cognitive_fail}`,
    });
  } else if (fn.cognitive >= t.cognitive_warn) {
    smells.push({
      type: 'high_cognitive_complexity',
      severity: 'warn',
      detail: `Cognitive complexity ${fn.cognitive}, threshold ${t.cognitive_fail}`,
    });
  }

  if (fn.parameter_count >= t.parameter_count_fail) {
    smells.push({
      type: 'too_many_parameters',
      severity: 'fail',
      detail: `${fn.parameter_count} parameters, threshold ${t.parameter_count_fail} fail`,
    });
  } else if (fn.parameter_count >= t.parameter_count_warn) {
    smells.push({
      type: 'too_many_parameters',
      severity: 'warn',
      detail: `${fn.parameter_count} parameters, threshold ${t.parameter_count_fail} fail`,
    });
  }

  return smells;
}
