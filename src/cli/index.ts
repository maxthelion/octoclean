#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig, findProjectRoot } from '../config/index.js';
import { logger, setLogLevel } from '../utils/logger.js';
import { runInit } from './init.js';
import { runScanCommand } from './scan.js';
import { runReport } from './report.js';
import { runRemediation } from '../remediation/index.js';
import { serveDashboard } from '../dashboard/server.js';
import { runDiff } from './diff.js';
import { runAssessCommand } from './assess.js';
import { runBackfill } from './backfill.js';
import type { ScanOptions, ReportOptions, AssessOptions, RemediateOptions, ServeOptions } from '../types/index.js';

const program = new Command();

program
  .name('codehealth')
  .description('Code quality analysis across git history — dashboard for humans, structured feed for agents')
  .version('0.1.0')
  .option('--debug', 'Enable debug logging')
  .hook('preAction', (thisCommand) => {
    if (thisCommand.opts().debug) {
      setLogLevel('debug');
    }
  });

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialise CodeHealth in the current repository')
  .action(async () => {
    const cwd = process.cwd();
    await runInit(cwd);
  });

// ─── scan ─────────────────────────────────────────────────────────────────────

program
  .command('scan')
  .description('Run a full mechanical scan and optional LLM assessment pass')
  .option('--commits <n>', 'Override history_depth for this run', parseInt)
  .option('--since <YYYY-MM-DD>', 'Scan commits since a specific date')
  .option('--ref <REF>', 'Scan a specific branch or tag')
  .option('--push-metrics', 'Push results to codehealth-metrics branch', false)
  .option('--no-llm', 'Skip LLM assessment pass')
  .option('--no-dynamic', 'Skip coverage even if configured')
  .option('--output <path>', 'Also write JSON to a local file')
  .action(async (opts) => {
    const cwd = findProjectRoot();
    const config = loadConfig(cwd);

    const options: ScanOptions = {
      commits: opts.commits,
      since: opts.since,
      ref: opts.ref,
      pushMetrics: opts.pushMetrics ?? false,
      noLlm: opts.noLlm ?? false,
      noDynamic: opts.noDynamic ?? false,
      output: opts.output,
    };

    try {
      await runScanCommand(options, config, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      if (program.opts().debug) console.error(err);
      process.exit(1);
    }
  });

// ─── assess ───────────────────────────────────────────────────────────────────

program
  .command('assess')
  .description('Run LLM assessment pass only, without re-running mechanical metrics')
  .option('--file <path>', 'Assess a single file')
  .option('--module <name>', 'Assess all files in a module')
  .option('--force', 'Re-assess files not flagged by mechanical metrics', false)
  .action(async (opts) => {
    const cwd = findProjectRoot();
    const config = loadConfig(cwd);

    const options: AssessOptions = {
      file: opts.file,
      module: opts.module,
      force: opts.force,
    };

    try {
      await runAssessCommand(options, config, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

// ─── report ───────────────────────────────────────────────────────────────────

program
  .command('report')
  .description('Print a summary of the latest snapshot to stdout')
  .option('--module <name>', 'Filter to a specific module')
  .option('--format <fmt>', 'Output format: text | json | markdown', 'text')
  .option('--worst <n>', 'Show only N worst-scoring files', parseInt)
  .option('--agent', 'Output in agent-optimised format', false)
  .action(async (opts) => {
    const cwd = findProjectRoot();

    const options: ReportOptions = {
      module: opts.module,
      format: opts.format,
      worst: opts.worst,
      agent: opts.agent,
    };

    try {
      await runReport(options, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

// ─── remediate ────────────────────────────────────────────────────────────────

program
  .command('remediate')
  .description('Run the remediation agent loop')
  .option('--dry-run', 'Show what would be done without committing', false)
  .option('--file <path>', 'Attempt remediation on a single file')
  .option('--max <n>', 'Override max_files_per_night for this run', parseInt)
  .action(async (opts) => {
    const cwd = findProjectRoot();
    const config = loadConfig(cwd);

    const options: RemediateOptions = {
      dryRun: opts.dryRun,
      file: opts.file,
      max: opts.max,
    };

    try {
      await runRemediation(options, config, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

// ─── serve ────────────────────────────────────────────────────────────────────

program
  .command('serve')
  .description('Serve the dashboard locally')
  .option('--port <n>', 'Port to listen on', parseInt, 4321)
  .option('--open', 'Open browser automatically', false)
  .action(async (opts) => {
    const cwd = findProjectRoot();

    const options: ServeOptions = {
      port: opts.port ?? 4321,
      open: opts.open ?? false,
    };

    try {
      await serveDashboard(options, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

// ─── backfill ─────────────────────────────────────────────────────────────────

program
  .command('backfill')
  .description('Generate historical snapshots by scanning past commits via git worktrees')
  .option('--days <n>',    'One commit per day for the last N days', parseInt)
  .option('--since <YYYY-MM-DD>', 'All commits since a specific date')
  .option('--commits <n>', 'Last N commits (uses sampling strategy from config)', parseInt)
  .option('--no-llm',      'Skip LLM assessments (default for backfill)', true)
  .option('--push-metrics','Push results to codehealth-metrics branch after backfill', false)
  .option('--dry-run',     'Show which commits would be scanned without scanning', false)
  .addHelpText('after', `
Examples:
  codehealth backfill --days 10
  codehealth backfill --since 2026-01-01
  codehealth backfill --commits 20 --push-metrics
  codehealth backfill --days 30 --dry-run`)
  .action(async (opts) => {
    const cwd    = findProjectRoot();
    const config = loadConfig(cwd);
    try {
      await runBackfill({
        days:        opts.days,
        since:       opts.since,
        commits:     opts.commits,
        noLlm:       opts.noLlm ?? true,
        pushMetrics: opts.pushMetrics ?? false,
        dryRun:      opts.dryRun ?? false,
      }, config, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      if (program.opts().debug) console.error(err);
      process.exit(1);
    }
  });

// ─── diff ─────────────────────────────────────────────────────────────────────

program
  .command('diff <from> <to>')
  .description('Compare health scores between two points in history')
  .addHelpText('after', `
Examples:
  codehealth diff HEAD~10 HEAD
  codehealth diff 2026-01-01 2026-03-01
  codehealth diff a1b2c3d 9f8e7d6`)
  .action(async (from: string, to: string) => {
    const cwd = findProjectRoot();

    try {
      await runDiff({ from, to }, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

program.parse(process.argv);
