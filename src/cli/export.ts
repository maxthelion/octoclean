/**
 * codehealth export --autoresearch
 *
 * Generates three files in the target directory:
 *
 *   autoresearch.sh       — benchmark script: runs codehealth scan --quick
 *                           and outputs METRIC lines for the autoresearch loop
 *   autoresearch.checks.sh — correctness gate: runs the project test suite
 *   autoresearch.md        — session context seeded from codehealth report --agent
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CodeHealthConfig, ExportOptions } from '../types/index.js';
import { loadLatestSnapshot } from '../metrics/index.js';
import { logger } from '../utils/logger.js';
import { getRepoName } from '../utils/git.js';

export async function runExport(
  options: ExportOptions,
  config: CodeHealthConfig,
  cwd: string
): Promise<void> {
  if (options.autoresearch !== undefined) {
    await exportAutoresearch(options.autoresearch, config, cwd);
  }
}

// ─── autoresearch export ──────────────────────────────────────────────────────

async function exportAutoresearch(
  outDir: string,
  config: CodeHealthConfig,
  cwd: string
): Promise<void> {
  const absOutDir = path.resolve(cwd, outDir);
  fs.mkdirSync(absOutDir, { recursive: true });

  const snapshot = loadLatestSnapshot(cwd);
  if (!snapshot) {
    logger.error('No snapshot found. Run: codehealth scan');
    process.exit(1);
  }

  const repo         = getRepoName(cwd);
  const baselineScore = Math.round(snapshot.summary.health_score * 100);
  const hasTests     = config.dynamic_metrics.coverage || !!config.dynamic_metrics.test_command;

  // ── autoresearch.sh ────────────────────────────────────────────────────────
  const benchmarkScript = buildBenchmarkScript(cwd);
  const benchmarkPath   = path.join(absOutDir, 'autoresearch.sh');
  fs.writeFileSync(benchmarkPath, benchmarkScript, { mode: 0o755 });
  logger.success(`Written: ${path.relative(cwd, benchmarkPath)}`);

  // ── autoresearch.checks.sh ─────────────────────────────────────────────────
  const checksScript = buildChecksScript(config);
  const checksPath   = path.join(absOutDir, 'autoresearch.checks.sh');
  fs.writeFileSync(checksPath, checksScript, { mode: 0o755 });
  logger.success(`Written: ${path.relative(cwd, checksPath)}`);

  // ── autoresearch.md ────────────────────────────────────────────────────────
  const md     = buildAutoresearchMd(snapshot, config, repo, baselineScore, cwd);
  const mdPath = path.join(absOutDir, 'autoresearch.md');
  fs.writeFileSync(mdPath, md, 'utf8');
  logger.success(`Written: ${path.relative(cwd, mdPath)}`);

  console.log('');
  console.log(`Baseline health score: ${baselineScore}`);
  console.log(`Red files: ${snapshot.summary.red_files}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review autoresearch.md — adjust the priority queue and constraints if needed');
  if (!hasTests) {
    console.log('  2. ⚠  No test command configured in .codehealth/config.yaml');
    console.log('     Set dynamic_metrics.test_command so autoresearch.checks.sh has a safety net');
  }
  console.log(`  ${hasTests ? '2' : '3'}. Start pi and ask it to run autoresearch`);
  console.log('');
}

// ─── File generators ──────────────────────────────────────────────────────────

function buildBenchmarkScript(cwd: string): string {
  return `#!/bin/bash
# octoclean benchmark script for pi autoresearch
# Runs a fast scan and outputs METRIC lines.
# Called by autoresearch after every experiment.
set -euo pipefail

SNAPSHOT=/tmp/octoclean-snapshot.json

# Quick scan: lizard only on changed files, carries forward unchanged metrics
codehealth scan --quick --no-llm --output "$SNAPSHOT"

# Extract metrics for autoresearch
node --input-type=module << 'EOF'
import { readFileSync } from 'fs';
const s = JSON.parse(readFileSync(process.env.SNAPSHOT || '/tmp/octoclean-snapshot.json', 'utf8'));
const files = s.files || [];
const maxCyclomatic = files.length ? Math.max(...files.map(f => f.cyclomatic || 0)) : 0;
const totalSmellsFail = files.reduce((n, f) => n + (f.smells||[]).filter(sm => sm.severity === 'fail').length, 0);

console.log('METRIC health_score=' + Math.round(s.summary.health_score * 100));
console.log('METRIC red_files=' + s.summary.red_files);
console.log('METRIC amber_files=' + s.summary.amber_files);
console.log('METRIC cyclomatic_max=' + maxCyclomatic);
console.log('METRIC fail_smells=' + totalSmellsFail);
EOF
`.replace('process.env.SNAPSHOT', `'${'/tmp/octoclean-snapshot.json'}'`);
}

function buildChecksScript(config: CodeHealthConfig): string {
  const testCmd = config.dynamic_metrics.test_command || 'npm test';
  return `#!/bin/bash
# octoclean correctness gate for pi autoresearch
# autoresearch cannot keep a change that fails this script.
set -euo pipefail

${testCmd} 2>&1 | tail -80
`;
}

function buildAutoresearchMd(
  snapshot: ReturnType<typeof loadLatestSnapshot>,
  config: CodeHealthConfig,
  repo: string,
  baselineScore: number,
  cwd: string
): string {
  if (!snapshot) return '';

  const { summary, files, agent_assessments } = snapshot;
  const assessmentsByFile = new Map(
    (agent_assessments?.files ?? []).map(f => [f.path, f.assessments])
  );

  // Priority queue: red and amber files, worst first
  const queue = files
    .filter(f => f.status === 'red' || f.status === 'amber')
    .sort((a, b) => a.health_score - b.health_score)
    .slice(0, 20);

  // Off-limits: high fan-in files
  const offLimits = files
    .filter(f => f.coupling.fan_in >= 5)
    .sort((a, b) => b.coupling.fan_in - a.coupling.fan_in);

  // Permitted actions by smell type
  const actionMap: Record<string, string[]> = {
    giant_function:           ['extract_function'],
    high_complexity:          ['extract_function', 'split_function'],
    high_cognitive_complexity: ['extract_function'],
    high_duplication:         ['consolidate_duplicate', 'extract_function'],
    dead_export:              ['remove_dead_export'],
    versioned_symbol:         ['rename_symbol'],
    naming_coherence:         ['rename_symbol', 'update_docstring'],
    docstring_faithfulness:   ['update_docstring'],
    competing_implementation: ['consolidate_duplicate'],
    intent_clarity:           ['extract_function', 'update_docstring'],
  };

  function permittedActionsForFile(f: (typeof files)[0]): string[] {
    const actions = new Set<string>();
    for (const smell of f.smells) {
      for (const a of actionMap[smell.type] ?? []) actions.add(a);
    }
    const assessments = assessmentsByFile.get(f.path) ?? [];
    for (const a of assessments) {
      for (const action of actionMap[a.type] ?? []) actions.add(action);
    }
    return [...actions].filter(a =>
      (config.remediation?.scope?.allow as string[] | undefined)?.includes(a) ?? true
    );
  }

  const queueLines = queue.map((f, i) => {
    const assessments = assessmentsByFile.get(f.path) ?? [];
    const primary = assessments.find(a => a.severity !== 'ok');
    const topSmell = f.smells.filter(s => s.severity === 'fail')[0]
                  ?? f.smells.filter(s => s.severity === 'warn')[0];
    const issue   = primary
      ? `${primary.type.replace(/_/g, ' ')} — ${primary.detail}`
      : topSmell
        ? `${topSmell.type.replace(/_/g, ' ')} — ${topSmell.detail}`
        : 'general complexity';
    const actions = permittedActionsForFile(f);
    const fanInWarning = f.coupling.fan_in >= 5
      ? `\n   ⚠ fan-in ${f.coupling.fan_in} — do not change exports or signatures` : '';

    return `${i + 1}. \`${f.path}\`
   Health: ${Math.round(f.health_score * 100)} (${f.status}) · LOC: ${f.loc} · Cyclomatic: ${f.cyclomatic}
   Issue: ${issue}
   Permitted actions: ${actions.length ? actions.join(', ') : 'extract_function, update_docstring'}${fanInWarning}`;
  }).join('\n\n');

  const offLimitsLines = offLimits.length
    ? offLimits.map(f => `- \`${f.path}\` (fan-in: ${f.coupling.fan_in})`).join('\n')
    : '(none)';

  return `# Autoresearch: improve ${repo} code health

## Objective

Improve the octoclean health score of \`${repo}\` from its current baseline of **${baselineScore}**.
Focus on the priority queue below. Measure progress after each change using \`./autoresearch.sh\`.

## Metrics

- **Primary**: \`health_score\` (0–100, **higher is better**)
- **Secondary**: \`red_files\`, \`amber_files\`, \`cyclomatic_max\`, \`fail_smells\`

## How to run

\`\`\`bash
./autoresearch.sh   # outputs METRIC health_score=N and secondary metrics
\`\`\`

## Baseline

| Metric | Value |
|--------|-------|
| Health score | ${baselineScore} |
| Red files | ${summary.red_files} |
| Amber files | ${summary.amber_files} |
| Green files | ${summary.green_files} |
| Total LOC | ${summary.total_loc.toLocaleString()} |

## Priority queue

Files ordered by worst health score. Focus here first.

${queueLines || '(no red or amber files — project is already healthy)'}

## Off limits

These files have many importers. Do **not** change their exports, function signatures, or public interfaces.

${offLimitsLines}

## Permitted actions

Only make changes that fall into these categories:

- **extract_function** — extract a repeated or overly complex block into a named helper
- **consolidate_duplicate** — merge two functions that independently implement the same logic
- **update_docstring** — update JSDoc to accurately reflect the current implementation
- **rename_symbol** — rename a function or variable to better reflect its responsibilities
- **remove_dead_export** — remove an unused exported symbol
- **split_function** — split a giant function at a natural boundary

## Constraints

- Tests must pass after every kept change (\`./autoresearch.checks.sh\`)
- Do not change any function's external signature or exported types
- Do not modify files listed in Off Limits
- Do not add new dependencies
- Keep changes minimal and focused — one issue at a time

## What's been tried

_(update this section as experiments accumulate)_
`;
}
