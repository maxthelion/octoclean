/**
 * codehealth pages
 *
 * Builds a static index.html from the latest snapshot and writes it to the
 * root of the codehealth-metrics branch, ready to be served by GitHub Pages.
 *
 * GitHub Pages setup (one-time, in repo Settings → Pages):
 *   Source: Deploy from a branch
 *   Branch: codehealth-metrics  /  (root)
 */

import { spawnSync } from 'node:child_process';
import { loadLatestSnapshot } from '../metrics/index.js';
import { writeMultipleToMetricsBranch, pushMetricsBranch } from '../metrics/branch.js';
import { buildDashboard } from '../dashboard/builder.js';
import { logger } from '../utils/logger.js';
import { git } from '../utils/git.js';

export interface PagesOptions {
  push: boolean;
  enable: boolean; // set up GitHub Pages via gh CLI
}

export async function runPages(options: PagesOptions, cwd: string): Promise<void> {
  if (options.enable) {
    await enableGitHubPages(cwd);
    return;
  }
  const snapshot = loadLatestSnapshot(cwd);
  if (!snapshot) {
    logger.error('No snapshot found. Run: codehealth scan');
    process.exit(1);
  }

  logger.step('Building static dashboard…');
  const html = buildDashboard(snapshot);

  writeMultipleToMetricsBranch(
    [{ path: 'index.html', content: html }],
    `chore: update dashboard (health: ${snapshot.summary.health_score}, commit: ${snapshot.commit})`,
    cwd
  );

  logger.success('index.html written to codehealth-metrics branch');
  logger.dim(`  Health: ${Math.round(snapshot.summary.health_score * 100)} · ${snapshot.summary.red_files} red · ${snapshot.summary.amber_files} amber · ${snapshot.summary.green_files} green`);

  if (options.push) {
    pushMetricsBranch(cwd);
  } else {
    logger.dim('  Run with --push to publish to GitHub Pages, or: git push origin codehealth-metrics');
  }

  console.log('');
  if (ghAvailable()) {
    console.log('To enable GitHub Pages, run:');
    console.log('  codehealth pages --enable');
  } else {
    console.log('GitHub Pages setup (one-time):');
    console.log('  Repo Settings → Pages → Deploy from branch');
    console.log('  Branch: codehealth-metrics   Folder: / (root)');
  }
  console.log('');
}

// ─── GitHub Pages enablement via gh CLI ───────────────────────────────────────

async function enableGitHubPages(cwd: string): Promise<void> {
  if (!ghAvailable()) {
    logger.error('gh CLI not found. Install it from https://cli.github.com or set up Pages manually:\n  Repo Settings → Pages → Branch: codehealth-metrics / (root)');
    process.exit(1);
  }

  // Ensure metrics branch is pushed to remote
  logger.step('Pushing codehealth-metrics branch to remote…');
  try {
    git(['push', 'origin', 'codehealth-metrics'], cwd);
  } catch {
    // Already up to date is fine
  }

  // Detect owner/repo from remote
  const remote = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    { cwd, encoding: 'utf8' });

  if (remote.status !== 0) {
    logger.error('Could not determine repo from gh CLI. Are you authenticated? Run: gh auth status');
    process.exit(1);
  }

  const nameWithOwner = remote.stdout.trim();

  // Check if Pages is already enabled
  const existing = spawnSync('gh', ['api', `repos/${nameWithOwner}/pages`],
    { cwd, encoding: 'utf8' });

  if (existing.status === 0) {
    const current = JSON.parse(existing.stdout);
    if (current.source?.branch === 'codehealth-metrics') {
      logger.success(`GitHub Pages already configured: ${current.html_url}`);
      return;
    }
    // Pages exists but on wrong branch — update it
    logger.step('Updating GitHub Pages source branch…');
    spawnSync('gh', ['api', `repos/${nameWithOwner}/pages`, '--method', 'PUT',
      '-F', 'source[branch]=codehealth-metrics', '-F', 'source[path]=/'],
      { cwd, encoding: 'utf8' });
    logger.success(`GitHub Pages updated → https://${nameWithOwner.split('/')[0]}.github.io/${nameWithOwner.split('/')[1]}/`);
    return;
  }

  // Enable Pages
  logger.step('Enabling GitHub Pages…');
  const result = spawnSync('gh', ['api', `repos/${nameWithOwner}/pages`, '--method', 'POST',
    '-F', 'source[branch]=codehealth-metrics', '-F', 'source[path]=/'],
    { cwd, encoding: 'utf8' });

  if (result.status !== 0) {
    logger.error(`Failed to enable Pages: ${result.stderr || result.stdout}`);
    process.exit(1);
  }

  const page = JSON.parse(result.stdout);
  logger.success(`GitHub Pages enabled: ${page.html_url}`);
  logger.dim('  It may take a minute for the first build to complete.');
}

function ghAvailable(): boolean {
  const result = spawnSync('gh', ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}
