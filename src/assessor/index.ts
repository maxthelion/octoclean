/**
 * LLM assessment orchestrator — runs the nightly assessment pass.
 * Prioritises files, runs per-file assessments in parallel, generates
 * module summaries via synthesis.
 */

import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit'; // lightweight concurrency limiter (we'll polyfill if not available)
import type {
  FileMetrics,
  ModuleMetrics,
  AgentAssessments,
  FileAssessments,
  LlmConfig,
} from '../types/index.js';
import { logger } from '../utils/logger.js';
import { assessFile } from './file-assessor.js';
import { selectFilesForAssessment } from './selector.js';
import { synthesiseModuleSummaries } from './synthesis.js';

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface AssessmentResult {
  agent_assessments: AgentAssessments;
  modules: ModuleMetrics[]; // with plain_summary filled in
}

export async function runAssessments(params: {
  files: FileMetrics[];
  modules: ModuleMetrics[];
  cwd: string;
  config: LlmConfig;
  previousAssessments: AgentAssessments | null;
}): Promise<AssessmentResult> {
  const { files, modules, cwd, config, previousAssessments } = params;

  if (!config.enabled) {
    logger.dim('LLM assessments disabled in config');
    return {
      agent_assessments: buildEmptyAssessments(config),
      modules,
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('ANTHROPIC_API_KEY not set — skipping LLM assessments');
    return {
      agent_assessments: buildEmptyAssessments(config),
      modules,
    };
  }

  const client = new Anthropic({ apiKey });

  // ── 1. Select files to assess ────────────────────────────────────────────
  const selectedFiles = selectFilesForAssessment(files, config.max_files_per_night, previousAssessments);
  logger.step(`Running LLM assessments on ${selectedFiles.length} file(s)…`);

  // ── 2. Assess files in parallel (max 5 concurrent) ────────────────────────
  const concurrency = 5;
  const limit = createConcurrencyLimit(concurrency);

  const fileAssessments: FileAssessments[] = await Promise.all(
    selectedFiles.map(file =>
      limit(async () => {
        logger.dim(`  Assessing ${file.path}…`);
        try {
          return await assessFile(file.path, file.functions, cwd, config, client);
        } catch (err) {
          logger.warn(`Assessment failed for ${file.path}: ${(err as Error).message}`);
          return { path: file.path, assessments: [] };
        }
      })
    )
  );

  // ── 3. Module synthesis ───────────────────────────────────────────────────
  logger.step('Generating module summaries…');
  const updatedModules = await synthesiseModuleSummaries(modules, files, config, client);

  const agent_assessments: AgentAssessments = {
    generated_at: new Date().toISOString(),
    model: config.model_file,
    prompt_version: '1.0.0',
    files: fileAssessments.filter(f => f.assessments.length > 0),
  };

  return { agent_assessments, modules: updatedModules };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEmptyAssessments(config: LlmConfig): AgentAssessments {
  return {
    generated_at: new Date().toISOString(),
    model: config.model_file,
    prompt_version: '1.0.0',
    files: [],
  };
}

/**
 * Simple concurrency limiter — avoids needing p-limit as a hard dependency.
 */
function createConcurrencyLimit(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = () => {
        active++;
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            active--;
            if (queue.length > 0) {
              queue.shift()!();
            }
          });
      };

      if (active < max) {
        execute();
      } else {
        queue.push(execute);
      }
    });
  }

  return run;
}
