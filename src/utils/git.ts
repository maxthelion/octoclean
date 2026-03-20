import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';

// ─── Low-level git helpers ────────────────────────────────────────────────────

export function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
  }

  return result.stdout.trim();
}

// ─── Repo info ────────────────────────────────────────────────────────────────

export function getRepoName(cwd: string): string {
  try {
    const remoteUrl = git(['remote', 'get-url', 'origin'], cwd);
    return path.basename(remoteUrl, '.git');
  } catch {
    return path.basename(cwd);
  }
}

export function getCurrentCommit(cwd: string): string {
  return git(['rev-parse', 'HEAD'], cwd);
}

export function getCurrentCommitShort(cwd: string): string {
  return git(['rev-parse', '--short', 'HEAD'], cwd);
}

export function getCommitMessage(commit: string, cwd: string): string {
  return git(['log', '-1', '--format=%s', commit], cwd);
}

export function hasRemote(cwd: string): boolean {
  try {
    git(['remote'], cwd);
    const remotes = git(['remote'], cwd);
    return remotes.length > 0;
  } catch {
    return false;
  }
}

// ─── Commit sampling ─────────────────────────────────────────────────────────

export interface CommitRef {
  hash: string;
  date: string;
  message: string;
}

/**
 * Get merge commits to the main branch (newest first).
 */
export function getMergeCommits(mainBranch: string, limit: number, cwd: string): CommitRef[] {
  const log = git(
    ['log', mainBranch, '--merges', `--max-count=${limit}`, '--format=%H|%cI|%s'],
    cwd
  );

  return parseCommitLog(log);
}

/**
 * Get one commit per week (newest first).
 */
export function getWeeklyCommits(mainBranch: string, limit: number, cwd: string): CommitRef[] {
  // --first-parent on main branch, one per week
  const log = git(
    ['log', mainBranch, '--first-parent', `--max-count=${limit * 7}`, '--format=%H|%cI|%s'],
    cwd
  );
  const all = parseCommitLog(log);

  // Deduplicate: keep first commit seen per ISO-week
  const seen = new Set<string>();
  return all.filter(c => {
    const week = weekKey(c.date);
    if (seen.has(week)) return false;
    seen.add(week);
    return true;
  }).slice(0, limit);
}

/**
 * Get every commit on the main branch (newest first).
 */
export function getEveryCommit(mainBranch: string, limit: number, cwd: string): CommitRef[] {
  const log = git(
    ['log', mainBranch, '--first-parent', `--max-count=${limit}`, '--format=%H|%cI|%s'],
    cwd
  );
  return parseCommitLog(log);
}

/**
 * Get commits since a specific date.
 */
export function getCommitsSince(date: string, mainBranch: string, cwd: string): CommitRef[] {
  const log = git(
    ['log', mainBranch, '--first-parent', `--after=${date}`, '--format=%H|%cI|%s'],
    cwd
  );
  return parseCommitLog(log);
}

// ─── File change detection ────────────────────────────────────────────────────

/**
 * List JS/TS files changed between two commits.
 */
export function getChangedFiles(fromCommit: string, toCommit: string, cwd: string): string[] {
  const output = git(
    ['diff', '--name-only', '--diff-filter=ACMR', fromCommit, toCommit, '--', '*.js', '*.ts', '*.jsx', '*.tsx'],
    cwd
  );
  return output ? output.split('\n').filter(Boolean) : [];
}

/**
 * Count commits that touched a file in the last N days.
 */
export function getChurn(filePath: string, days: number, cwd: string): number {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const output = git(
    ['log', `--after=${sinceStr}`, '--oneline', '--', filePath],
    cwd
  );
  return output ? output.split('\n').filter(Boolean).length : 0;
}

/**
 * Get co-changed files (files frequently changed together with the given file).
 */
export function getCoChangedFiles(
  filePath: string,
  days: number,
  cwd: string
): Record<string, number> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  // Get all commits that touched this file
  const commits = git(
    ['log', `--after=${sinceStr}`, '--format=%H', '--', filePath],
    cwd
  ).split('\n').filter(Boolean);

  const coChangeCounts: Record<string, number> = {};

  for (const commit of commits) {
    const files = git(['diff-tree', '--no-commit-id', '-r', '--name-only', commit], cwd)
      .split('\n')
      .filter(f => f && f !== filePath);

    for (const f of files) {
      coChangeCounts[f] = (coChangeCounts[f] ?? 0) + 1;
    }
  }

  return coChangeCounts;
}

// ─── Orphan branch management ─────────────────────────────────────────────────

export const METRICS_BRANCH = 'codehealth-metrics';

/**
 * Check whether the metrics branch exists locally.
 */
export function metricsBranchExists(cwd: string): boolean {
  try {
    git(['rev-parse', '--verify', METRICS_BRANCH], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the orphan metrics branch if it doesn't exist.
 */
export function ensureMetricsBranch(cwd: string): void {
  if (metricsBranchExists(cwd)) return;

  // Save current branch
  const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);

  // Create orphan branch
  git(['checkout', '--orphan', METRICS_BRANCH], cwd);
  git(['rm', '-rf', '--quiet', '.'], cwd);

  // Create initial commit with a README
  execSync(
    `echo "# CodeHealth Metrics\\n\\nAuto-generated metrics branch. Do not edit manually." > README.md && git add README.md && git commit -m "chore: initialise codehealth-metrics branch"`,
    { cwd, stdio: 'ignore', shell: '/bin/bash' }
  );

  // Return to previous branch
  git(['checkout', currentBranch], cwd);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCommitLog(log: string): CommitRef[] {
  if (!log) return [];
  return log.split('\n').filter(Boolean).map(line => {
    const [hash, date, ...messageParts] = line.split('|');
    return { hash: hash!, date: date!, message: messageParts.join('|') };
  });
}

function weekKey(isoDate: string): string {
  const d = new Date(isoDate);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getUTCDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
