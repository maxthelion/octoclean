import ora from 'ora';
import { logger } from '../utils/logger.js';
import { runPages } from './pages.js';
import { runScan } from '../scanner/index.js';
import { scoreFiles, aggregateModules, computeSummary } from '../scorer/index.js';
import { runAssessments } from '../assessor/index.js';
import { buildSnapshot, saveSnapshot, loadLatestSnapshot } from '../metrics/index.js';
import { ensureMetricsBranch } from '../metrics/branch.js';
import { getCurrentCommit, getCommitMessage } from '../utils/git.js';
import type { CodeHealthConfig, ScanOptions } from '../types/index.js';

export async function runScanCommand(
  options: ScanOptions,
  config: CodeHealthConfig,
  cwd: string
): Promise<void> {
  ensureMetricsBranch(cwd);

  const spinner = ora({ text: 'Starting scan…', color: 'cyan' }).start();

  try {
    // ── 1. Mechanical scan ───────────────────────────────────────────────────
    spinner.text = 'Running mechanical analysis…';
    const previousSnapshot = loadLatestSnapshot(cwd);

    const scanResult = await runScan({
      config,
      cwd,
      quick:             options.quick,
      skipCoverage:      options.noDynamic,
      skipLlm:           options.noLlm,
      previousDeadExports: previousSnapshot?.drift_signals.dead_export_growth?.current,
      previousFiles:     previousSnapshot?.files,
    });

    spinner.text = 'Computing health scores…';
    const scoredFiles = scoreFiles(scanResult.files, config);

    const modules = aggregateModules(
      scoredFiles,
      config,
      previousSnapshot?.modules
    );

    const summary = computeSummary(
      scoredFiles,
      modules,
      previousSnapshot?.summary
    );

    // ── 2. LLM assessments ───────────────────────────────────────────────────
    let agentAssessments = null;
    let finalModules = modules;

    if (!options.noLlm && config.llm_assessments.enabled) {
      spinner.text = 'Running LLM assessments…';
      const assessmentResult = await runAssessments({
        files: scoredFiles,
        modules,
        cwd,
        config: config.llm_assessments,
        previousAssessments: previousSnapshot?.agent_assessments ?? null,
      });
      agentAssessments = assessmentResult.agent_assessments;
      finalModules = assessmentResult.modules;
    }

    // ── 3. Build and save snapshot ───────────────────────────────────────────
    spinner.text = 'Saving snapshot…';
    const commit = getCurrentCommit(cwd);
    const commitMessage = getCommitMessage(commit, cwd);

    const snapshot = buildSnapshot({
      commit: commit.slice(0, 8),
      commitMessage,
      cwd,
      summary,
      modules: finalModules,
      files: scoredFiles,
      drift_signals: scanResult.drift_signals,
      agent_assessments: agentAssessments,
    });

    saveSnapshot(snapshot, cwd, options.pushMetrics);

    // ── 4. Build GitHub Pages static site if requested ────────────────────────
    if (options.pages) {
      await runPages({ push: options.pushMetrics }, cwd);
    }

    // ── 5. Write to output file if requested ──────────────────────────────────
    if (options.output) {
      const fs = await import('node:fs');
      fs.writeFileSync(options.output, JSON.stringify(snapshot, null, 2), 'utf8');
      logger.dim(`  Also written to ${options.output}`);
    }

    spinner.stop();

    // ── 5. Print summary ──────────────────────────────────────────────────────
    printScanSummary(snapshot);

  } catch (err) {
    spinner.fail('Scan failed');
    throw err;
  }
}

function printScanSummary(snapshot: Parameters<typeof buildSnapshot>[0] extends never ? never : Awaited<ReturnType<typeof buildSnapshot>>): void {
  const s = snapshot.summary;
  const score = Math.round(s.health_score * 100);
  const trend = s.trend === 'improving' ? '↑' : s.trend === 'degrading' ? '↓' : '→';
  const colour = s.health_score >= 0.75 ? '\x1b[32m' : s.health_score >= 0.5 ? '\x1b[33m' : '\x1b[31m';
  const reset = '\x1b[0m';

  console.log('');
  console.log(`${colour}Health: ${score}${reset}  ${trend} ${s.trend} (${s.trend_delta >= 0 ? '+' : ''}${Math.round(s.trend_delta * 100)}pts)`);
  console.log(`Files: ${s.green_files} green · ${s.amber_files} amber · ${s.red_files} red`);

  if (s.red_files > 0) {
    const worst = snapshot.files
      .filter(f => f.status === 'red')
      .sort((a, b) => a.health_score - b.health_score)
      .slice(0, 3);

    console.log('\nWorst files:');
    for (const f of worst) {
      console.log(`  ${f.path} — health ${Math.round(f.health_score * 100)}`);
    }
  }
  console.log('');
  console.log('Run: codehealth serve --open');
  console.log('');
}
