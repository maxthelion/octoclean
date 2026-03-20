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

import { loadLatestSnapshot } from '../metrics/index.js';
import { writeMultipleToMetricsBranch, pushMetricsBranch } from '../metrics/branch.js';
import { buildDashboard } from '../dashboard/builder.js';
import { logger } from '../utils/logger.js';

export interface PagesOptions {
  push: boolean;
}

export async function runPages(options: PagesOptions, cwd: string): Promise<void> {
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
  console.log('GitHub Pages setup (one-time):');
  console.log('  Repo Settings → Pages → Deploy from branch');
  console.log('  Branch: codehealth-metrics   Folder: / (root)');
  console.log('');
}
