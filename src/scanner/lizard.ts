/**
 * Lizard adapter — cyclomatic complexity, LOC (NCSS), parameter count.
 *
 * Install with: pip install lizard
 *
 * Actual XML schema from `lizard --xml -l javascript -V`:
 *
 * <measure type="Function">
 *   <labels><label>Nr.</label><label>NCSS</label><label>CCN</label></labels>
 *   <item name="fnName ( p1 , p2 ) at /abs/path/file.js:lineStart">
 *     <value>1</value>      <!-- Nr (sequence, ignored) -->
 *     <value>4</value>      <!-- NCSS ≈ LOC -->
 *     <value>2</value>      <!-- CCN (cyclomatic complexity) -->
 *   </item>
 * </measure>
 *
 * <measure type="File">
 *   <item name="/abs/path/file.js">
 *     <value>1</value>      <!-- Nr -->
 *     <value>12</value>     <!-- NCSS -->
 *     <value>3</value>      <!-- CCN (max across functions) -->
 *     <value>2</value>      <!-- function count -->
 *   </item>
 * </measure>
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import type { Smell, ThresholdConfig } from '../types/index.js';

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

export function runLizard(files: string[], cwd: string): LizardFileResult[] | null {
  const check = spawnSync('lizard', ['--version'], { encoding: 'utf8' });
  if (check.status !== 0) {
    logger.warn('lizard not found. Install with: pip install lizard');
    return null;
  }

  if (files.length === 0) return [];

  // Absolute paths for lizard, resolved from cwd
  const absPaths = files.map(f => path.resolve(cwd, f));

  const result = spawnSync(
    'lizard',
    [
      '--xml',          // XML output (-X)
      '-V',             // verbose: includes params in function name
      '-l', 'javascript',
      '-l', 'typescript',
      ...absPaths,
    ],
    { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
  );

  if (result.status !== 0 && !result.stdout) {
    logger.warn(`lizard exited with status ${result.status}: ${result.stderr?.trim()}`);
    return null;
  }

  if (!result.stdout?.trim()) {
    logger.debug('lizard produced no output');
    return [];
  }

  return parseLizardXml(result.stdout, cwd);
}

// ─── XML parser ───────────────────────────────────────────────────────────────

function parseLizardXml(xml: string, cwd: string): LizardFileResult[] {
  const fileMap = new Map<string, LizardFileResult>();

  // ── Function items ──────────────────────────────────────────────────────
  // Pattern: <item name="fnName ( params ) at /abs/path:line">
  //            <value>Nr</value><value>NCSS</value><value>CCN</value>
  //          </item>
  const functionItemPattern = /<item name="([^"]+)">([\s\S]*?)<\/item>/g;
  let inFunctionMeasure = false;
  let inFileMeasure = false;

  // Split into function and file measure sections first
  const functionSection = extractMeasureSection(xml, 'Function');
  const fileSection = extractMeasureSection(xml, 'File');

  // ── Parse function-level items ──────────────────────────────────────────
  if (functionSection) {
    const itemPattern = /<item name="([^"]+)">([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;

    while ((m = itemPattern.exec(functionSection)) !== null) {
      const rawName = m[1]!;
      const valuesXml = m[2]!;

      const values = parseValues(valuesXml);
      if (values.length < 3) continue;

      // values[0] = Nr (skip), values[1] = NCSS, values[2] = CCN
      const ncss = parseInt(values[1]!, 10);
      const ccn = parseInt(values[2]!, 10);

      const parsed = parseFunctionName(rawName, cwd);
      if (!parsed) continue;

      const { name, filePath, lineStart, paramCount } = parsed;

      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, { path: filePath, loc: 0, cyclomatic: 0, cognitive: 0, functions: [] });
      }

      fileMap.get(filePath)!.functions.push({
        name,
        line_start: lineStart,
        line_end: lineStart + ncss - 1, // approximate
        loc: ncss,
        cyclomatic: ccn,
        cognitive: estimateCognitive(ccn),
        parameter_count: paramCount,
      });
    }
  }

  // ── Parse file-level items ──────────────────────────────────────────────
  if (fileSection) {
    const itemPattern = /<item name="([^"]+)">([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;

    while ((m = itemPattern.exec(fileSection)) !== null) {
      const absPath = m[1]!.trim();
      const valuesXml = m[2]!;
      const values = parseValues(valuesXml);

      if (values.length < 3) continue;

      // values[0] = Nr, values[1] = NCSS, values[2] = CCN (max), values[3] = fn count
      const ncss = parseInt(values[1]!, 10);
      const ccn  = parseInt(values[2]!, 10);

      const filePath = path.relative(cwd, absPath);

      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, { path: filePath, loc: ncss, cyclomatic: ccn, cognitive: estimateCognitive(ccn), functions: [] });
      } else {
        // Update file-level aggregates (lizard's file-level CCN is already the max)
        const entry = fileMap.get(filePath)!;
        entry.loc = ncss;
        entry.cyclomatic = ccn;
        entry.cognitive = estimateCognitive(ccn);
      }
    }
  }

  // Fill in any files that only appear in function section
  for (const entry of fileMap.values()) {
    if (entry.loc === 0 && entry.functions.length > 0) {
      entry.loc = entry.functions.reduce((sum, f) => sum + f.loc, 0);
      entry.cyclomatic = Math.max(...entry.functions.map(f => f.cyclomatic));
      entry.cognitive  = Math.max(...entry.functions.map(f => f.cognitive));
    }
  }

  return [...fileMap.values()];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the content of a <measure type="X"> block.
 */
function extractMeasureSection(xml: string, type: string): string | null {
  const re = new RegExp(`<measure type="${type}"[^>]*>([\\s\\S]*?)<\\/measure>`, 'i');
  const m = re.exec(xml);
  return m ? m[1]! : null;
}

/**
 * Extract all <value> text nodes from a block.
 */
function parseValues(xml: string): string[] {
  return [...xml.matchAll(/<value>([^<]*)<\/value>/g)].map(m => m[1]!.trim());
}

/**
 * Parse the lizard verbose function item name:
 *   "functionName ( p1 , p2 ) at /abs/path/file.js:42"
 *
 * Returns null if the format doesn't match.
 */
function parseFunctionName(
  raw: string,
  cwd: string
): { name: string; filePath: string; lineStart: number; paramCount: number } | null {
  // Split on " at " — last occurrence to handle edge cases in function names
  const atIdx = raw.lastIndexOf(' at ');
  if (atIdx === -1) return null;

  const namePart = raw.slice(0, atIdx).trim();
  const locationPart = raw.slice(atIdx + 4).trim(); // e.g. "/abs/path/file.js:42"

  // Location: path:line
  const colonIdx = locationPart.lastIndexOf(':');
  if (colonIdx === -1) return null;

  const absFilePath = locationPart.slice(0, colonIdx);
  const lineStart = parseInt(locationPart.slice(colonIdx + 1), 10);
  const filePath = path.relative(cwd, absFilePath);

  // Name + params: "functionName ( p1 , p2 )"
  // Extract params from between first "(" and last ")"
  const parenOpen = namePart.indexOf('(');
  const parenClose = namePart.lastIndexOf(')');

  let name: string;
  let paramCount = 0;

  if (parenOpen !== -1 && parenClose !== -1 && parenClose > parenOpen) {
    name = namePart.slice(0, parenOpen).trim();
    const paramsStr = namePart.slice(parenOpen + 1, parenClose).trim();
    // Count parameters: split by comma, filter empty
    if (paramsStr) {
      paramCount = paramsStr.split(',').filter(p => p.trim()).length;
    }
  } else {
    name = namePart;
  }

  if (!name || isNaN(lineStart)) return null;

  return { name, filePath, lineStart, paramCount };
}

/**
 * Rough cognitive complexity estimate from cyclomatic.
 * Lizard doesn't natively compute cognitive complexity.
 * A proper implementation would require AST-level analysis.
 */
function estimateCognitive(cyclomatic: number): number {
  return Math.round(cyclomatic * 1.3);
}

// ─── Smell detection ──────────────────────────────────────────────────────────

export function getFunctionSmells(fn: LizardFunctionResult, t: ThresholdConfig): Smell[] {
  const smells: Smell[] = [];

  if (fn.loc >= t.function_loc_fail) {
    smells.push({ type: 'giant_function', severity: 'fail', detail: `${fn.loc} lines, threshold ${t.function_loc_fail}` });
  } else if (fn.loc >= t.function_loc_warn) {
    smells.push({ type: 'giant_function', severity: 'warn', detail: `${fn.loc} lines, threshold ${t.function_loc_fail}` });
  }

  if (fn.cyclomatic >= t.cyclomatic_fail) {
    smells.push({ type: 'high_complexity', severity: 'fail', detail: `Cyclomatic complexity ${fn.cyclomatic}, threshold ${t.cyclomatic_fail}` });
  } else if (fn.cyclomatic >= t.cyclomatic_warn) {
    smells.push({ type: 'high_complexity', severity: 'warn', detail: `Cyclomatic complexity ${fn.cyclomatic}, threshold ${t.cyclomatic_fail}` });
  }

  if (fn.cognitive >= t.cognitive_fail) {
    smells.push({ type: 'high_cognitive_complexity', severity: 'fail', detail: `Cognitive complexity ${fn.cognitive}, threshold ${t.cognitive_fail}` });
  } else if (fn.cognitive >= t.cognitive_warn) {
    smells.push({ type: 'high_cognitive_complexity', severity: 'warn', detail: `Cognitive complexity ${fn.cognitive}, threshold ${t.cognitive_fail}` });
  }

  if (fn.parameter_count >= t.parameter_count_fail) {
    smells.push({ type: 'too_many_parameters', severity: 'fail', detail: `${fn.parameter_count} parameters, threshold ${t.parameter_count_fail}` });
  } else if (fn.parameter_count >= t.parameter_count_warn) {
    smells.push({ type: 'too_many_parameters', severity: 'warn', detail: `${fn.parameter_count} parameters, threshold ${t.parameter_count_fail}` });
  }

  return smells;
}
