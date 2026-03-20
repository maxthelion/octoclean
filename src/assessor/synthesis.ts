/**
 * Structural synthesis pass using Claude Sonnet.
 * Generates plain-language module summaries from aggregated signals.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ModuleMetrics, FileMetrics } from '../types/index.js';
import type { LlmConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';

export const SYNTHESIS_PROMPT_VERSION = '1.0.0';

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Generate plain_summary strings for each module.
 * Returns modules with summaries filled in.
 */
export async function synthesiseModuleSummaries(
  modules: ModuleMetrics[],
  files: FileMetrics[],
  config: LlmConfig,
  client: Anthropic
): Promise<ModuleMetrics[]> {
  const updated: ModuleMetrics[] = [];

  for (const mod of modules) {
    const moduleFiles = files.filter(f => f.module === mod.name);
    const summary = await generateModuleSummary(mod, moduleFiles, config, client);

    updated.push({ ...mod, plain_summary: summary });
  }

  return updated;
}

// ─── Summary generation ───────────────────────────────────────────────────────

async function generateModuleSummary(
  mod: ModuleMetrics,
  files: FileMetrics[],
  config: LlmConfig,
  client: Anthropic
): Promise<string | null> {
  const topSmells = files
    .flatMap(f => f.smells)
    .filter(s => s.severity === 'fail')
    .slice(0, 5)
    .map(s => `- ${s.detail}`)
    .join('\n');

  const worstFiles = files
    .sort((a, b) => a.health_score - b.health_score)
    .slice(0, 3)
    .map(f => `- ${f.path} (health: ${f.health_score})`)
    .join('\n');

  const prompt = `Generate a one or two sentence plain-language summary of this code module's health status for a non-technical stakeholder.

Module: ${mod.name} (${mod.path})
Health score: ${mod.health_score} (${mod.status}, ${mod.trend})
Files: ${files.length}
LOC: ${mod.signals.loc}
Coverage: ${mod.signals.coverage !== null ? `${Math.round(mod.signals.coverage * 100)}%` : 'not measured'}
Churn (30d): ${mod.signals.churn_30d} commits

Worst files:
${worstFiles || '(none)'}

Critical issues:
${topSmells || '(none)'}

Write in plain English, no jargon. Be direct about problems. Do not mention specific metric values — translate them into plain language like "changes frequently", "mostly untested", "hard to change safely".`;

  try {
    const response = await client.messages.create({
      model: config.model_synthesis,
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : null;
    return text?.trim() ?? null;
  } catch (err) {
    logger.warn(`Synthesis failed for module ${mod.name}: ${(err as Error).message}`);
    return null;
  }
}
