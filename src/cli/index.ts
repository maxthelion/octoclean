#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfig, findProjectRoot } from '../config/index.js';
import { logger, setLogLevel } from '../utils/logger.js';
import { runInit } from './init.js';
import { runScanCommand } from './scan.js';
import { runReport } from './report.js';
import { runExport } from './export.js';
import { serveDashboard } from '../dashboard/server.js';
import { runDiff } from './diff.js';
import { runBackfill } from './backfill.js';
import { runHistory } from './history.js';
import { runPages } from './pages.js';
import type { ScanOptions, ReportOptions, ServeOptions } from '../types/index.js';

const program = new Command();

program
  .name('codehealth')
  .description('Code quality analysis for JS/TS repos — pairs with pi autoresearch for fixing')
  .version('0.2.0')
  .option('--debug', 'Enable debug logging')
  .hook('preAction', (thisCommand) => {
    if (thisCommand.opts().debug) setLogLevel('debug');
  });

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialise octoclean in the current repository')
  .action(async () => {
    try {
      await runInit(process.cwd());
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

// ─── scan ─────────────────────────────────────────────────────────────────────

program
  .command('scan')
  .description('Run a mechanical scan and optional LLM assessment pass')
  .option('--quick',              'Fast mode: lizard only on changed files, for autoresearch loops')
  .option('--commits <n>',        'Override history_depth for this run', parseInt)
  .option('--since <YYYY-MM-DD>', 'Scan commits since a specific date')
  .option('--push-metrics',       'Push results to codehealth-metrics branch', false)
  .option('--pages',              'Build and push static dashboard after scanning (for GitHub Pages)', false)
  .option('--no-llm',             'Skip LLM assessment pass')
  .option('--no-dynamic',         'Skip coverage even if configured')
  .option('--output <path>',      'Write JSON snapshot to a local file')
  .addHelpText('after', `
Examples:
  codehealth scan
  codehealth scan --no-llm
  codehealth scan --quick --output /tmp/snap.json   # fast, for autoresearch.sh
  codehealth scan --push-metrics`)
  .action(async (opts) => {
    const cwd    = findProjectRoot();
    const config = loadConfig(cwd);
    const options: ScanOptions = {
      quick:       opts.quick       ?? false,
      commits:     opts.commits,
      since:       opts.since,
      ref:         undefined,
      pushMetrics: opts.pushMetrics ?? false,
      pages:       opts.pages       ?? false,
      noLlm:       opts.noLlm      ?? false,
      noDynamic:   opts.noDynamic   ?? false,
      output:      opts.output,
    };
    try {
      await runScanCommand(options, config, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      if (program.opts().debug) console.error(err);
      process.exit(1);
    }
  });

// ─── report ───────────────────────────────────────────────────────────────────

program
  .command('report')
  .description('Print a summary of the latest snapshot to stdout')
  .option('--module <name>',  'Filter to a specific module')
  .option('--format <fmt>',   'Output format: text | json | markdown', 'text')
  .option('--worst <n>',      'Show only N worst-scoring files', parseInt)
  .option('--agent',          'Structured text output for LLM agents', false)
  .addHelpText('after', `
Examples:
  codehealth report
  codehealth report --agent
  codehealth report --format markdown --worst 20
  codehealth report --format json > snapshot.json`)
  .action(async (opts) => {
    const cwd = findProjectRoot();
    const options: ReportOptions = {
      module: opts.module,
      format: opts.format,
      worst:  opts.worst,
      agent:  opts.agent,
    };
    try {
      await runReport(options, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

// ─── export ───────────────────────────────────────────────────────────────────

program
  .command('export')
  .description('Export session files for use with other tools')
  .option('--autoresearch [dir]', 'Generate autoresearch.sh, autoresearch.checks.sh, and autoresearch.md', '.')
  .addHelpText('after', `
Examples:
  codehealth export --autoresearch           # writes to current directory
  codehealth export --autoresearch ./ar      # writes to ./ar/`)
  .action(async (opts) => {
    const cwd    = findProjectRoot();
    const config = loadConfig(cwd);
    if (opts.autoresearch !== undefined) {
      const outDir = typeof opts.autoresearch === 'string' ? opts.autoresearch : '.';
      try {
        await runExport({ autoresearch: outDir }, config, cwd);
      } catch (err) {
        logger.error((err as Error).message);
        process.exit(1);
      }
    } else {
      logger.error('Specify an export target, e.g. --autoresearch');
      process.exit(1);
    }
  });

// ─── serve ────────────────────────────────────────────────────────────────────

program
  .command('serve')
  .description('Serve the dashboard locally')
  .option('--port <n>', 'Port to listen on', parseInt, 4321)
  .option('--open',     'Open browser automatically', false)
  .action(async (opts) => {
    const cwd = findProjectRoot();
    const options: ServeOptions = { port: opts.port ?? 4321, open: opts.open ?? false };
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
  .option('--days <n>',           'One commit per day for the last N days', parseInt)
  .option('--since <YYYY-MM-DD>', 'All commits since a specific date')
  .option('--commits <n>',        'Last N commits', parseInt)
  .option('--push-metrics',       'Push results after backfill', false)
  .option('--dry-run',            'Preview without scanning', false)
  .addHelpText('after', `
Examples:
  codehealth backfill --days 30
  codehealth backfill --since 2026-01-01
  codehealth backfill --days 30 --dry-run
  codehealth backfill --days 30 --push-metrics`)
  .action(async (opts) => {
    const cwd    = findProjectRoot();
    const config = loadConfig(cwd);
    try {
      await runBackfill({
        days:        opts.days,
        since:       opts.since,
        commits:     opts.commits,
        noLlm:       true,
        pushMetrics: opts.pushMetrics ?? false,
        dryRun:      opts.dryRun     ?? false,
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
  codehealth diff 2026-01-01 2026-03-01`)
  .action(async (from: string, to: string) => {
    const cwd = findProjectRoot();
    try {
      await runDiff({ from, to }, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

// ─── pages ────────────────────────────────────────────────────────────────────

program
  .command('pages')
  .description('Build static dashboard and write to codehealth-metrics branch for GitHub Pages')
  .option('--push', 'Push codehealth-metrics to remote after building', false)
  .addHelpText('after', `
Writes index.html to the root of the codehealth-metrics branch.

GitHub Pages setup (one-time, in repo Settings → Pages):
  Source: Deploy from a branch
  Branch: codehealth-metrics   Folder: / (root)

Examples:
  codehealth pages
  codehealth pages --push`)
  .action(async (opts) => {
    const cwd = findProjectRoot();
    try {
      await runPages({ push: opts.push ?? false }, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

// ─── history ──────────────────────────────────────────────────────────────────

program
  .command('history <subcommand>')
  .description('Manage snapshot history')
  .argument('[target]', 'For remove: timestamp prefix or commit hash')
  .addHelpText('after', `
Subcommands:
  list              Show all snapshots ordered by date
  trim              Remove duplicate scans of the same commit
  remove <target>   Remove snapshot by timestamp prefix or commit hash
  clear             Wipe all snapshots

Examples:
  codehealth history list
  codehealth history trim
  codehealth history remove 2026-03-20T09:29
  codehealth history clear`)
  .action(async (subcommand, target) => {
    const cwd   = findProjectRoot();
    const valid = ['list', 'trim', 'clear', 'remove'];
    if (!valid.includes(subcommand)) {
      logger.error(`Unknown subcommand '${subcommand}'. Use: ${valid.join(', ')}`);
      process.exit(1);
    }
    if (subcommand === 'remove' && !target) {
      logger.error('remove requires a timestamp prefix or commit hash');
      process.exit(1);
    }
    try {
      await runHistory({ subcommand, target }, cwd);
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  });

program.parse(process.argv);
