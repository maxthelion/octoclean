/**
 * Metrics branch management — read/write snapshots to the codehealth-metrics
 * orphan branch, or fall back to .codehealth/local/ if no remote is available.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { logger } from '../utils/logger.js';
import { git, hasRemote, METRICS_BRANCH } from '../utils/git.js';

export const LOCAL_FALLBACK_DIR = '.codehealth/local';
export const METRICS_DIR = 'metrics';
export const INDEX_FILE = 'index.json';

// ─── Branch bootstrap ─────────────────────────────────────────────────────────

/**
 * Ensure the codehealth-metrics orphan branch exists.
 * Creates it with an initial commit if it doesn't.
 */
export function ensureMetricsBranch(cwd: string): void {
  try {
    git(['rev-parse', '--verify', METRICS_BRANCH], cwd);
    logger.debug(`Metrics branch '${METRICS_BRANCH}' already exists`);
    return;
  } catch {
    // Branch doesn't exist — create it
  }

  logger.step(`Creating orphan branch '${METRICS_BRANCH}'…`);

  const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);

  try {
    execSync(
      [
        `git checkout --orphan ${METRICS_BRANCH}`,
        'git rm -rf --quiet . 2>/dev/null || true',
        'mkdir -p metrics dashboard',
        `printf '# CodeHealth Metrics\\n\\nAuto-generated metrics branch. Do not edit manually.' > README.md`,
        'git add README.md',
        `git commit -m "chore: initialise ${METRICS_BRANCH} branch"`,
        `git checkout ${currentBranch}`,
      ].join(' && '),
      { cwd, stdio: 'pipe', shell: '/bin/bash' }
    );

    logger.success(`Created '${METRICS_BRANCH}' branch`);
  } catch (err) {
    logger.warn(`Could not create metrics branch: ${(err as Error).message}`);
    logger.warn(`Falling back to local storage at ${LOCAL_FALLBACK_DIR}`);
    fs.mkdirSync(path.join(cwd, LOCAL_FALLBACK_DIR, METRICS_DIR), { recursive: true });
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Read a file from the metrics branch without checking it out.
 * Falls back to local storage if the branch doesn't exist.
 */
export function readFromMetricsBranch(filePath: string, cwd: string): string | null {
  try {
    return git(['show', `${METRICS_BRANCH}:${filePath}`], cwd);
  } catch {
    // Try local fallback
    const localPath = path.join(cwd, LOCAL_FALLBACK_DIR, filePath);
    if (fs.existsSync(localPath)) {
      return fs.readFileSync(localPath, 'utf8');
    }
    return null;
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Write a file to the metrics branch via a worktree-less commit.
 * Falls back to local storage.
 */
export function writeToMetricsBranch(
  filePath: string,
  content: string,
  commitMessage: string,
  cwd: string
): void {
  try {
    writeViaGitHashObject(filePath, content, commitMessage, cwd);
  } catch (err) {
    logger.warn(`Could not write to metrics branch: ${(err as Error).message}`);
    logger.warn(`Writing to local fallback: ${LOCAL_FALLBACK_DIR}/${filePath}`);
    writeToLocal(filePath, content, cwd);
  }
}

/**
 * Write multiple files to the metrics branch in a single commit.
 */
export function writeMultipleToMetricsBranch(
  files: Array<{ path: string; content: string }>,
  commitMessage: string,
  cwd: string
): void {
  try {
    commitLocalToMetricsBranch(files, commitMessage, cwd);
  } catch (err) {
    logger.warn(`Metrics branch write failed: ${(err as Error).message}. Using local fallback.`);
    for (const file of files) {
      writeToLocal(file.path, file.content, cwd);
    }
  }
}

// ─── Push ─────────────────────────────────────────────────────────────────────

export function pushMetricsBranch(cwd: string): void {
  if (!hasRemote(cwd)) {
    logger.warn('No git remote configured; skipping push');
    return;
  }

  logger.step(`Pushing '${METRICS_BRANCH}' to remote…`);
  try {
    git(['push', 'origin', METRICS_BRANCH], cwd);
    logger.success('Metrics pushed');
  } catch (err) {
    logger.warn(`Push failed: ${(err as Error).message}`);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function writeViaGitHashObject(
  filePath: string,
  content: string,
  commitMessage: string,
  cwd: string
): void {
  // This approach uses a temporary worktree to avoid disturbing the working tree.
  execSync(
    [
      `TMPDIR=$(mktemp -d)`,
      `git worktree add "$TMPDIR" ${METRICS_BRANCH} 2>/dev/null`,
      `mkdir -p "$TMPDIR/$(dirname ${JSON.stringify(filePath)})"`,
      `cat > "$TMPDIR/${filePath}" << 'CODEHEALTH_EOF'\n${content}\nCODEHEALTH_EOF`,
      `cd "$TMPDIR"`,
      `git add ${JSON.stringify(filePath)}`,
      `git commit -m ${JSON.stringify(commitMessage)} --allow-empty`,
      `git worktree remove "$TMPDIR"`,
    ].join(' && '),
    { cwd, stdio: 'pipe', shell: '/bin/bash' }
  );
}

function commitLocalToMetricsBranch(
  files: Array<{ path: string; content: string }>,
  commitMessage: string,
  cwd: string
): void {
  // Write to a temp worktree and commit
  const tmpWorktree = path.join(cwd, '.codehealth', '.worktree-tmp');

  try {
    execSync(
      `git worktree add "${tmpWorktree}" ${METRICS_BRANCH} 2>/dev/null || git worktree add "${tmpWorktree}" --checkout ${METRICS_BRANCH}`,
      { cwd, stdio: 'pipe', shell: '/bin/bash' }
    );

    for (const file of files) {
      const dest = path.join(tmpWorktree, file.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content, 'utf8');
    }

    const filePaths = files.map(f => `"${f.path}"`).join(' ');
    execSync(
      `git add ${filePaths} && git commit -m ${JSON.stringify(commitMessage)} --allow-empty`,
      { cwd: tmpWorktree, stdio: 'pipe', shell: '/bin/bash' }
    );
  } finally {
    try {
      execSync(`git worktree remove "${tmpWorktree}" --force`, { cwd, stdio: 'pipe' });
    } catch { /* best effort */ }
  }
}

function writeToLocal(filePath: string, content: string, cwd: string): void {
  const dest = path.join(cwd, LOCAL_FALLBACK_DIR, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
}
