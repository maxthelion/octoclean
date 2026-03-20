/**
 * Remediation agent orchestrator.
 *
 * Reads the latest snapshot, prioritises files, generates fix branches,
 * runs tests, and merges clean passes.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import nodePath from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type {
  CodeHealthConfig,
  FileMetrics,
  Assessment,
  RemediationAction,
} from '../types/index.js';
import { loadLatestSnapshot } from '../metrics/index.js';
import { logger } from '../utils/logger.js';
import { git, getCurrentCommitShort } from '../utils/git.js';
import { prioritiseFiles, type PrioritisedFile } from './prioritiser.js';
import {
  loadQuarantine,
  saveQuarantine,
  recordFailure,
  isQuarantined,
  getActiveQuarantineEntries,
} from './quarantine.js';
import type { RemediateOptions } from '../types/index.js';

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function runRemediation(
  options: RemediateOptions,
  config: CodeHealthConfig,
  cwd: string
): Promise<void> {
  if (!config.remediation.enabled) {
    logger.warn('Remediation is disabled in config');
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('ANTHROPIC_API_KEY not set — cannot run remediation');
    return;
  }

  const client = new Anthropic({ apiKey });

  // ── 1. Load latest snapshot ───────────────────────────────────────────────
  const snapshot = loadLatestSnapshot(cwd);
  if (!snapshot) {
    logger.error('No snapshot found. Run `codehealth scan` first.');
    process.exit(1);
  }

  logger.step(`Loaded snapshot from ${snapshot.generated_at} (health: ${snapshot.summary.health_score})`);

  // ── 2. Load quarantine store ──────────────────────────────────────────────
  let quarantine = loadQuarantine(cwd);
  const quarantined = getActiveQuarantineEntries(quarantine);
  if (quarantined.length > 0) {
    logger.dim(`  ${quarantined.length} file(s) in quarantine`);
  }

  // ── 3. Prioritise ─────────────────────────────────────────────────────────
  const maxFiles = options.max ?? config.remediation.max_files_per_night;
  const filesToProcess = options.file
    ? snapshot.files.filter(f => f.path === options.file)
    : snapshot.files;

  const prioritised = prioritiseFiles(
    filesToProcess,
    snapshot.agent_assessments,
    quarantine,
    config.llm_assessments.min_confidence_to_act,
    config.remediation.scope.allow,
    maxFiles
  );

  if (prioritised.length === 0) {
    logger.success('Nothing to remediate — queue is empty or all files are quarantined');
    return;
  }

  logger.step(`Processing ${prioritised.length} file(s)…`);
  if (options.dryRun) {
    logger.dim('  (dry run — no changes will be committed)');
    printDryRunPlan(prioritised, quarantined);
    return;
  }

  // ── 4. Attempt fixes ──────────────────────────────────────────────────────
  for (const candidate of prioritised) {
    const result = await attemptRemediation(candidate, config, cwd, client);

    if (result.success) {
      logger.success(`  Fixed: ${candidate.file.path}`);
    } else {
      logger.warn(`  Failed: ${candidate.file.path} — ${result.reason}`);
      quarantine = recordFailure(
        candidate.file.path,
        result.attemptedAction,
        result.reason,
        config.remediation.quarantine_after_failures,
        quarantine
      );
      saveQuarantine(quarantine, cwd);
    }
  }
}

// ─── Fix attempt ──────────────────────────────────────────────────────────────

interface RemediationAttempt {
  success: boolean;
  reason: string;
  attemptedAction: RemediationAction;
}

async function attemptRemediation(
  candidate: PrioritisedFile,
  config: CodeHealthConfig,
  cwd: string,
  client: Anthropic
): Promise<RemediationAttempt> {
  const branchName = `${config.remediation.branch_prefix}/${sanitisePath(candidate.file.path)}`;
  const action = candidate.permittedActions[0] as RemediationAction;

  logger.dim(`  → Creating branch: ${branchName}`);

  try {
    // Create a fix branch from current HEAD
    git(['checkout', '-b', branchName], cwd);

    // Generate the fix using Claude
    const fix = await generateFix(candidate, action, cwd, config, client);
    if (!fix) {
      git(['checkout', '-'], cwd);
      git(['branch', '-D', branchName], cwd);
      return { success: false, reason: 'LLM could not generate a valid fix', attemptedAction: action };
    }

    // Apply the fix
    applyFix(candidate.file.path, fix.content, cwd);

    // Commit it
    git(['add', candidate.file.path], cwd);
    git(['commit', '-m', `fix(codehealth): ${fix.description}\n\n${fix.rationale}`], cwd);

    // Run tests
    if (config.dynamic_metrics.test_command) {
      const testPassed = runTests(config.dynamic_metrics.test_command, cwd);
      if (!testPassed) {
        git(['checkout', '-'], cwd);
        git(['branch', '-D', branchName], cwd);
        return { success: false, reason: 'Tests failed after applying fix', attemptedAction: action };
      }
    }

    // Tests passed — merge to main branch (or leave branch for review)
    // For v1, we leave the branch for human review and report success
    git(['checkout', '-'], cwd);
    logger.dim(`  Branch ready for review: ${branchName}`);

    return { success: true, reason: '', attemptedAction: action };

  } catch (err) {
    // Ensure we're back on the original branch
    try {
      git(['checkout', '-'], cwd);
      git(['branch', '-D', branchName], cwd);
    } catch { /* best effort */ }

    return {
      success: false,
      reason: (err as Error).message,
      attemptedAction: action,
    };
  }
}

// ─── LLM fix generation ───────────────────────────────────────────────────────

interface GeneratedFix {
  content: string;
  description: string;
  rationale: string;
}

async function generateFix(
  candidate: PrioritisedFile,
  action: RemediationAction,
  cwd: string,
  config: CodeHealthConfig,
  client: Anthropic
): Promise<GeneratedFix | null> {
  const source = fs.readFileSync(nodePath.join(cwd, candidate.file.path), 'utf8');
  const assessment = candidate.primaryAssessment;

  const prompt = buildFixPrompt(source, action, assessment, candidate.file);

  try {
    const response = await client.messages.create({
      model: config.llm_assessments.model_file,
      max_tokens: 4096,
      system: `You are a senior software engineer performing focused, minimal refactoring. 
You only make the specific change requested. You do not change interfaces, exported types, or function signatures unless explicitly asked.
You output valid JSON only.`,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const json = extractJson(text);

    if (!json?.content || !json?.description) return null;

    return {
      content: String(json.content),
      description: String(json.description),
      rationale: String(json.rationale ?? ''),
    };
  } catch {
    return null;
  }
}

function buildFixPrompt(
  source: string,
  action: RemediationAction,
  assessment: Assessment | null,
  file: FileMetrics
): string {
  const actionDescriptions: Record<RemediationAction, string> = {
    rename_symbol: 'Rename a function or variable to better reflect its actual responsibilities.',
    extract_function: 'Extract a repeated or overly complex block into a named helper function.',
    consolidate_duplicate: 'Merge two functions that implement the same logic into one, with the other delegating to it.',
    update_docstring: 'Update the JSDoc comment to accurately reflect the current implementation.',
    remove_dead_export: 'Remove an unused exported symbol.',
    change_interface: 'Change a function interface (PROHIBITED).',
    modify_exports: 'Modify exports (PROHIBITED).',
    alter_data_structure: 'Alter a data structure (PROHIBITED).',
  };

  return `Apply this specific refactoring to the source file:

Action: ${action}
Description: ${actionDescriptions[action]}

${assessment ? `Assessment context: ${assessment.detail}` : ''}

Current source:
\`\`\`javascript
${source}
\`\`\`

Constraints:
- Do NOT change any function signatures or exported interfaces
- Do NOT change exported type definitions
- Keep the change minimal and focused
- Preserve all existing behaviour

Respond with JSON only:
{
  "content": "<the complete updated file content>",
  "description": "<one-line commit message suffix, e.g. 'extract validateAddress helper from processPayment'>",
  "rationale": "<one sentence explaining what was changed and why>"
}`;
}

// ─── Test runner ──────────────────────────────────────────────────────────────

function runTests(testCommand: string, cwd: string): boolean {
  try {
    execSync(testCommand, { cwd, stdio: 'ignore', shell: '/bin/sh', timeout: 120_000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Dry run output ───────────────────────────────────────────────────────────

function printDryRunPlan(
  prioritised: PrioritisedFile[],
  quarantined: ReturnType<typeof getActiveQuarantineEntries>
): void {
  console.log('\nPRIORITY QUEUE (dry run)\n');
  for (let i = 0; i < prioritised.length; i++) {
    const c = prioritised[i]!;
    console.log(`${i + 1}. ${c.file.path}`);
    console.log(`   Health: ${c.file.health_score} (${c.file.status})`);
    console.log(`   Confidence: ${c.confidence.toFixed(2)}`);
    if (c.primaryAssessment) {
      console.log(`   Issue: ${c.primaryAssessment.type} — ${c.primaryAssessment.detail}`);
    }
    console.log(`   Actions: ${c.permittedActions.join(', ')}`);
    console.log();
  }

  if (quarantined.length > 0) {
    console.log('QUARANTINED\n');
    for (const q of quarantined) {
      console.log(`- ${q.path} (${q.failures} failure(s), until ${q.quarantined_until.split('T')[0]})`);
    }
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sanitisePath(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 40);
}

function applyFix(filePath: string, content: string, cwd: string): void {
  fs.writeFileSync(nodePath.join(cwd, filePath), content, 'utf8');
}

function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]!);
  } catch {
    return null;
  }
}
