/**
 * `codehealth assess` — LLM-only pass over changed/flagged files.
 * Reads the latest snapshot, runs assessments, and writes an updated snapshot.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CodeHealthConfig, AssessOptions } from '../types/index.js';
import { loadLatestSnapshot, saveSnapshot } from '../metrics/index.js';
import { runAssessments } from '../assessor/index.js';
import { logger } from '../utils/logger.js';

export async function runAssessCommand(
  options: AssessOptions,
  config: CodeHealthConfig,
  cwd: string
): Promise<void> {
  const snapshot = loadLatestSnapshot(cwd);
  if (!snapshot) {
    logger.error('No snapshot found. Run: codehealth scan');
    process.exit(1);
  }

  logger.step(`Loaded snapshot from ${snapshot.generated_at}`);

  // Filter to target files/modules
  let targetFiles = snapshot.files;
  if (options.file) {
    targetFiles = snapshot.files.filter(f => f.path === options.file);
    if (targetFiles.length === 0) {
      logger.error(`File not found in snapshot: ${options.file}`);
      process.exit(1);
    }
  } else if (options.module) {
    targetFiles = snapshot.files.filter(f => f.module === options.module);
    if (targetFiles.length === 0) {
      logger.error(`Module not found in snapshot: ${options.module}`);
      process.exit(1);
    }
  }

  // If not --force, only assess flagged files (non-green)
  if (!options.force) {
    targetFiles = targetFiles.filter(f => f.status !== 'green');
  }

  logger.step(`Assessing ${targetFiles.length} file(s)…`);

  const { agent_assessments, modules } = await runAssessments({
    files: targetFiles,
    modules: snapshot.modules,
    cwd,
    config: config.llm_assessments,
    previousAssessments: snapshot.agent_assessments,
  });

  // Merge updated assessments back into snapshot and save
  const updated = {
    ...snapshot,
    agent_assessments,
    modules,
    generated_at: new Date().toISOString(),
  };

  saveSnapshot(updated, cwd, false);
  logger.success(`Assessment complete. ${agent_assessments.files.length} file(s) assessed.`);
}
