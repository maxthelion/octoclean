/**
 * madge adapter — import fan-in / fan-out coupling analysis.
 *
 * madge must be installed: npm install --save-dev madge
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import type { CouplingMetrics } from '../types/index.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DependencyGraph = Record<string, string[]>;

export interface CouplingResult {
  /** Map of file path → coupling metrics */
  files: Map<string, CouplingMetrics>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Build the dependency graph using madge and derive fan-in/fan-out per file.
 */
export function runMadge(targetDir: string, cwd: string): CouplingResult | null {
  const localBin = path.join(cwd, 'node_modules', '.bin', 'madge');
  const bin = fs.existsSync(localBin) ? localBin : 'madge';

  const result = spawnSync(
    bin,
    ['--json', '--extensions', 'js,ts,jsx,tsx', targetDir],
    { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );

  if (result.status !== 0 || !result.stdout) {
    logger.warn('madge failed or not installed. Install with: npm install --save-dev madge');
    return null;
  }

  let graph: DependencyGraph;
  try {
    graph = JSON.parse(result.stdout);
  } catch {
    logger.warn('Failed to parse madge output');
    return null;
  }

  return buildCouplingMetrics(graph);
}

// ─── Metric computation ───────────────────────────────────────────────────────

function buildCouplingMetrics(graph: DependencyGraph): CouplingResult {
  const fanOut = new Map<string, number>();
  const fanIn = new Map<string, number>();

  // Initialise all known files
  for (const file of Object.keys(graph)) {
    if (!fanOut.has(file)) fanOut.set(file, 0);
    if (!fanIn.has(file)) fanIn.set(file, 0);
  }

  for (const [file, deps] of Object.entries(graph)) {
    // Fan-out: number of files this file imports
    fanOut.set(file, deps.length);

    // Fan-in: number of files that import this file
    for (const dep of deps) {
      fanIn.set(dep, (fanIn.get(dep) ?? 0) + 1);
    }
  }

  const files = new Map<string, CouplingMetrics>();
  const allFiles = new Set([...fanOut.keys(), ...fanIn.keys()]);

  for (const file of allFiles) {
    files.set(file, {
      fan_in: fanIn.get(file) ?? 0,
      fan_out: fanOut.get(file) ?? 0,
    });
  }

  return { files };
}

// ─── Circular dependency detection ───────────────────────────────────────────

export interface CircularDep {
  cycle: string[];
}

/**
 * Find circular dependencies in the graph (DFS-based).
 */
export function findCircularDeps(graph: DependencyGraph): CircularDep[] {
  const visited = new Set<string>();
  const stack = new Set<string>();
  const cycles: CircularDep[] = [];

  function dfs(node: string, path: string[]): void {
    if (stack.has(node)) {
      const cycleStart = path.indexOf(node);
      cycles.push({ cycle: path.slice(cycleStart) });
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    stack.add(node);

    for (const dep of graph[node] ?? []) {
      dfs(dep, [...path, node]);
    }

    stack.delete(node);
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return cycles;
}
