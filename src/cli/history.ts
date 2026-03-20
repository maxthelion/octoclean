/**
 * codehealth history — inspect and prune the snapshot index.
 *
 * Commands:
 *   codehealth history list              — show all snapshots
 *   codehealth history clear             — remove all snapshots (reset)
 *   codehealth history trim              — keep only the latest snapshot per commit
 *   codehealth history remove <timestamp> — remove a specific snapshot
 */

import { logger } from '../utils/logger.js';
import { loadIndex } from '../metrics/index.js';
import { writeMultipleToMetricsBranch, METRICS_DIR, INDEX_FILE } from '../metrics/branch.js';
import { getRepoName } from '../utils/git.js';
import type { IndexFile, IndexEntry } from '../types/index.js';

export type HistorySubcommand = 'list' | 'clear' | 'trim' | 'remove';

export interface HistoryOptions {
  subcommand: HistorySubcommand;
  target?: string; // for remove: the timestamp to remove
}

export async function runHistory(options: HistoryOptions, cwd: string): Promise<void> {
  switch (options.subcommand) {
    case 'list':   return listSnapshots(cwd);
    case 'clear':  return clearSnapshots(cwd);
    case 'trim':   return trimSnapshots(cwd);
    case 'remove': return removeSnapshot(options.target!, cwd);
  }
}

// ─── list ─────────────────────────────────────────────────────────────────────

function listSnapshots(cwd: string): void {
  const index = loadIndex(cwd);
  if (!index || index.snapshots.length === 0) {
    logger.warn('No snapshots found.');
    return;
  }

  const sorted = [...index.snapshots].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  console.log(`\n${index.repo} — ${sorted.length} snapshot(s)\n`);
  console.log('  Date                     Commit    Health  Files (g/a/r)');
  console.log('  ' + '─'.repeat(62));

  for (const s of sorted) {
    const date   = new Date(s.timestamp).toLocaleString();
    const score  = String(Math.round(s.summary.health_score * 100)).padStart(3);
    const files  = `${s.summary.green_files}/${s.summary.amber_files}/${s.summary.red_files}`;
    const commit = s.commit.slice(0, 8);
    console.log(`  ${date.padEnd(25)}  ${commit}  ${score}     ${files}`);
  }
  console.log('');
}

// ─── clear ────────────────────────────────────────────────────────────────────

function clearSnapshots(cwd: string): void {
  const repo  = getRepoName(cwd);
  const empty: IndexFile = { schema_version: 1, repo, latest: '', snapshots: [] };

  writeMultipleToMetricsBranch(
    [{ path: INDEX_FILE, content: JSON.stringify(empty, null, 2) }],
    'chore: clear snapshot history',
    cwd
  );

  logger.success('All snapshots cleared. Run codehealth scan to start fresh.');
}

// ─── trim ─────────────────────────────────────────────────────────────────────

/**
 * Keep only the latest snapshot per commit hash.
 * This removes duplicate scans of the same code state (e.g. runs with
 * different threshold configs, or repeated scans of the same commit).
 */
function trimSnapshots(cwd: string): void {
  const index = loadIndex(cwd);
  if (!index) { logger.warn('No snapshots found.'); return; }

  const before = index.snapshots.length;

  // For each commit, keep the most recent snapshot
  const byCommit = new Map<string, IndexEntry>();
  for (const s of index.snapshots) {
    const existing = byCommit.get(s.commit);
    if (!existing || new Date(s.timestamp) > new Date(existing.timestamp)) {
      byCommit.set(s.commit, s);
    }
  }

  const kept = [...byCommit.values()].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const removed = before - kept.length;
  if (removed === 0) {
    logger.success('Nothing to trim — all snapshots are already unique per commit.');
    return;
  }

  const updated: IndexFile = {
    ...index,
    latest: kept[0]?.file ?? '',
    snapshots: kept,
  };

  writeMultipleToMetricsBranch(
    [{ path: INDEX_FILE, content: JSON.stringify(updated, null, 2) }],
    `chore: trim ${removed} duplicate snapshot(s)`,
    cwd
  );

  logger.success(`Removed ${removed} duplicate snapshot(s). ${kept.length} remain.`);
}

// ─── remove ───────────────────────────────────────────────────────────────────

function removeSnapshot(target: string, cwd: string): void {
  const index = loadIndex(cwd);
  if (!index) { logger.warn('No snapshots found.'); return; }

  // Match by timestamp prefix or commit hash
  const match = index.snapshots.find(s =>
    s.timestamp.startsWith(target) || s.commit.startsWith(target)
  );

  if (!match) {
    logger.error(`No snapshot matching '${target}'. Run: codehealth history list`);
    return;
  }

  const remaining = index.snapshots.filter(s => s !== match);
  const updated: IndexFile = {
    ...index,
    latest: remaining[0]?.file ?? '',
    snapshots: remaining,
  };

  writeMultipleToMetricsBranch(
    [{ path: INDEX_FILE, content: JSON.stringify(updated, null, 2) }],
    `chore: remove snapshot ${match.timestamp}`,
    cwd
  );

  logger.success(`Removed snapshot: ${match.timestamp} (commit ${match.commit}, health ${Math.round(match.summary.health_score * 100)})`);
}
