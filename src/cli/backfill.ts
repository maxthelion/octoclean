/**
 * codehealth backfill
 *
 * Generates historical snapshots by checking out past commits into
 * temporary git worktrees, scanning each one, and writing snapshots
 * to the codehealth-metrics branch.
 *
 * The main working tree is never touched.
 *
 * Usage:
 *   codehealth backfill --days 10        # one commit per day, last 10 days
 *   codehealth backfill --since 2026-01-01
 *   codehealth backfill --commits 20     # last N commits by sampling strategy
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import ora from 'ora';
import type { CodeHealthConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { git } from '../utils/git.js';
import { runScan } from '../scanner/index.js';
import { scoreFiles, aggregateModules, computeSummary } from '../scorer/index.js';
import { buildSnapshot, saveSnapshot, loadIndex } from '../metrics/index.js';
import { ensureMetricsBranch } from '../metrics/branch.js';

// ─── Options ──────────────────────────────────────────────────────────────────

export interface BackfillOptions {
  days?: number;
  since?: string;
  commits?: number;
  noLlm: boolean;
  pushMetrics: boolean;
  dryRun: boolean;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function runBackfill(
  options: BackfillOptions,
  config: CodeHealthConfig,
  cwd: string
): Promise<void> {
  ensureMetricsBranch(cwd);

  // ── 1. Determine commits to scan ─────────────────────────────────────────
  const candidates = getCommitCandidates(options, config, cwd);
  if (candidates.length === 0) {
    logger.warn('No commits found in range.');
    return;
  }

  // ── 2. Filter already-scanned commits ────────────────────────────────────
  const index = loadIndex(cwd);
  const scannedCommits = new Set(index?.snapshots.map(s => s.commit) ?? []);

  const toScan = candidates.filter(c => !scannedCommits.has(c.hash.slice(0, 8)));
  if (toScan.length === 0) {
    logger.success('All commits in range already have snapshots.');
    return;
  }

  logger.step(`Backfilling ${toScan.length} commit(s) (${candidates.length - toScan.length} already scanned)…`);

  if (options.dryRun) {
    console.log('\nDry run — would scan:\n');
    toScan.forEach((c, i) => console.log(`  ${i + 1}. ${c.hash.slice(0, 8)}  ${c.date.slice(0, 10)}  ${c.message}`));
    return;
  }

  // ── 3. Scan each commit oldest-first (so timeline builds in order) ────────
  const orderedToScan = [...toScan].reverse();
  let succeeded = 0;

  for (let i = 0; i < orderedToScan.length; i++) {
    const commit = orderedToScan[i]!;
    const spinner = ora({
      text: `[${i + 1}/${orderedToScan.length}] ${commit.hash.slice(0, 8)}  ${commit.date.slice(0, 10)}  ${commit.message.slice(0, 50)}`,
      color: 'cyan',
    }).start();

    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-backfill-'));

    try {
      // Create worktree at this commit
      git(['worktree', 'add', '--detach', worktreeDir, commit.hash], cwd);

      // Symlink node_modules from main tree so tools that need them work
      symlinkNodeModules(cwd, worktreeDir);

      // Run mechanical scan in the worktree
      const scanResult = await runScan({
        config,
        cwd: worktreeDir,
        skipCoverage: true,        // skip coverage for historical scans
        skipLlm: options.noLlm,
      });

      const scoredFiles  = scoreFiles(scanResult.files, config);
      const modules      = aggregateModules(scoredFiles, config);
      const summary      = computeSummary(scoredFiles, modules);

      // Build snapshot with the commit's actual date, not now
      const snapshot = {
        ...buildSnapshot({
          commit: commit.hash.slice(0, 8),
          commitMessage: commit.message,
          cwd,
          summary,
          modules,
          files: scoredFiles,
          drift_signals: scanResult.drift_signals,
          agent_assessments: null,
        }),
        generated_at: commit.date, // use the commit's timestamp for correct timeline
      };

      saveSnapshot(snapshot, cwd, false); // don't push per-snapshot; push at end
      succeeded++;
      spinner.succeed(`${commit.hash.slice(0, 8)}  health: ${Math.round(summary.health_score * 100)}  (${summary.green_files}g/${summary.amber_files}a/${summary.red_files}r)`);

    } catch (err) {
      spinner.fail(`${commit.hash.slice(0, 8)}  failed: ${(err as Error).message}`);
    } finally {
      // Always clean up the worktree
      removeWorktree(worktreeDir, cwd);
    }
  }

  logger.success(`Backfill complete. ${succeeded}/${orderedToScan.length} snapshots written.`);

  if (options.pushMetrics && succeeded > 0) {
    const { pushMetricsBranch } = await import('../metrics/branch.js');
    pushMetricsBranch(cwd);
  }
}

// ─── Commit selection ─────────────────────────────────────────────────────────

interface Commit { hash: string; date: string; message: string; }

function getCommitCandidates(
  options: BackfillOptions,
  config: CodeHealthConfig,
  cwd: string
): Commit[] {
  const branch = config.main_branch;
  const limit  = options.commits ?? config.history_depth;

  const raw = (() => {
    if (options.since) {
      return git(['log', branch, '--first-parent', `--after=${options.since}`, '--format=%H|%cI|%s'], cwd);
    }
    // Fetch enough commits to cover N days or N commits
    const fetchN = options.days ? options.days * 10 : limit * 2;
    return git(['log', branch, '--first-parent', `--max-count=${fetchN}`, '--format=%H|%cI|%s'], cwd);
  })();

  if (!raw.trim()) return [];

  const all: Commit[] = raw.trim().split('\n').map(line => {
    const [hash, date, ...msg] = line.split('|');
    return { hash: hash!.trim(), date: date!.trim(), message: msg.join('|').trim() };
  });

  if (options.days) {
    return onePerDay(all, options.days);
  }

  return all.slice(0, limit);
}

/**
 * From a list of commits (newest first), pick the latest commit for each
 * calendar day, up to maxDays days total.
 */
function onePerDay(commits: Commit[], maxDays: number): Commit[] {
  const byDay = new Map<string, Commit>();

  for (const c of commits) {
    const day = c.date.slice(0, 10); // YYYY-MM-DD
    if (!byDay.has(day)) byDay.set(day, c);
  }

  // Return newest-first, capped at maxDays
  return [...byDay.values()].slice(0, maxDays);
}

// ─── Worktree helpers ─────────────────────────────────────────────────────────

/**
 * Symlink node_modules from the main working tree into the worktree so
 * tools like madge and ts-unused-exports can resolve imports.
 * Falls through silently if node_modules doesn't exist.
 */
function symlinkNodeModules(mainCwd: string, worktreeDir: string): void {
  const src  = path.join(mainCwd,    'node_modules');
  const dest = path.join(worktreeDir, 'node_modules');
  if (!fs.existsSync(src) || fs.existsSync(dest)) return;
  try {
    fs.symlinkSync(src, dest, 'dir');
  } catch {
    /* non-fatal — tools will just fall back to not using node_modules */
  }
}

function removeWorktree(worktreeDir: string, cwd: string): void {
  try {
    git(['worktree', 'remove', '--force', worktreeDir], cwd);
  } catch {
    // Fallback: manual removal
    try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
