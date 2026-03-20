/**
 * Versioned symbol detection — finds identifiers with _v2, _new, _refactored, etc. suffixes.
 * Uses regex over source text; a future iteration could use AST for more precision.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { VersionedSymbol } from '../types/index.js';
import { getChurn } from '../utils/git.js';

// ─── Patterns ─────────────────────────────────────────────────────────────────

const VERSION_SUFFIX_PATTERN =
  /\b([a-zA-Z_$][a-zA-Z0-9_$]*(?:_v\d+|_new|_old|_refactored|_updated|_deprecated|_legacy|_bak|_backup|_temp|_tmp|_copy))\b/g;

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Scan a list of files for versioned symbol names.
 */
export function detectVersionedSymbols(
  files: string[],
  cwd: string,
  currentCommit: string
): VersionedSymbol[] {
  const results: VersionedSymbol[] = [];

  for (const relPath of files) {
    const absPath = path.join(cwd, relPath);
    if (!fs.existsSync(absPath)) continue;

    const source = fs.readFileSync(absPath, 'utf8');
    const found = scanSource(source, relPath, currentCommit, cwd);
    results.push(...found);
  }

  return results;
}

// ─── Source scanner ───────────────────────────────────────────────────────────

function scanSource(
  source: string,
  filePath: string,
  currentCommit: string,
  cwd: string
): VersionedSymbol[] {
  const seen = new Set<string>();
  const results: VersionedSymbol[] = [];

  // Skip comments and string literals for false-positive reduction
  const stripped = stripComments(source);

  VERSION_SUFFIX_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = VERSION_SUFFIX_PATTERN.exec(stripped)) !== null) {
    const name = match[1]!;
    if (seen.has(name)) continue;
    seen.add(name);

    // Heuristic severity: _legacy, _deprecated, _old → warn; _v2+ → info → warn
    const severity = classifySeverity(name);

    results.push({
      name,
      file: filePath,
      introduced_commit: currentCommit, // approximate; a full git-log blame would be more accurate
      severity,
    });
  }

  return results;
}

function classifySeverity(name: string): 'warn' | 'ok' {
  const lower = name.toLowerCase();
  if (
    lower.endsWith('_deprecated') ||
    lower.endsWith('_legacy') ||
    lower.endsWith('_old') ||
    lower.endsWith('_bak') ||
    lower.endsWith('_backup') ||
    lower.endsWith('_temp') ||
    lower.endsWith('_tmp')
  ) {
    return 'warn';
  }
  // _v2, _new, _refactored, _copy — less urgent but still flagged
  return 'warn';
}

/**
 * Rudimentary comment and string literal stripper to reduce false positives.
 * Not perfect but good enough for symbol name detection.
 */
function stripComments(source: string): string {
  // Remove line comments
  let result = source.replace(/\/\/[^\n]*/g, '');
  // Remove block comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  // Replace string literals with empty strings
  result = result.replace(/(["'`])(?:(?!\1)[\s\S])*?\1/g, '""');
  return result;
}
