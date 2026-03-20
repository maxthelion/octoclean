/**
 * Per-file LLM assessment pass using Claude Haiku.
 * Runs docstring faithfulness, naming coherence, and intent clarity per function.
 * Runs competing implementation detection for function pairs within the same file.
 */

import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { Assessment, AssessmentType, FileAssessments, FunctionMetrics } from '../types/index.js';
import type { LlmConfig } from '../types/index.js';
import { logger } from '../utils/logger.js';
import * as DocstringPrompt from './prompts/docstring-faithfulness.js';
import * as NamingPrompt from './prompts/naming-coherence.js';
import * as CompetingPrompt from './prompts/competing-implementation.js';
import * as IntentPrompt from './prompts/intent-clarity.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExtractedFunction {
  name: string;
  jsdoc: string | null;
  body: string;
  lineStart: number;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run all applicable LLM assessments on a single file.
 */
export async function assessFile(
  filePath: string,
  functionMetrics: FunctionMetrics[],
  cwd: string,
  config: LlmConfig,
  client: Anthropic
): Promise<FileAssessments> {
  const absPath = path.join(cwd, filePath);
  if (!fs.existsSync(absPath)) {
    return { path: filePath, assessments: [] };
  }

  const source = fs.readFileSync(absPath, 'utf8');
  const functions = extractFunctions(source, functionMetrics);

  const assessments: Assessment[] = [];

  // Per-function assessments
  for (const fn of functions) {
    const fnAssessments = await assessFunction(fn, config, client);
    assessments.push(...fnAssessments);
  }

  // Competing implementation pairs (only for files with 2+ functions)
  if (functions.length >= 2) {
    const competing = await detectCompetingImplementations(functions, config, client);
    assessments.push(...competing);
  }

  return { path: filePath, assessments };
}

// ─── Per-function assessments ─────────────────────────────────────────────────

async function assessFunction(
  fn: ExtractedFunction,
  config: LlmConfig,
  client: Anthropic
): Promise<Assessment[]> {
  const results: Assessment[] = [];

  // Docstring faithfulness — only if there's a JSDoc
  if (fn.jsdoc) {
    const result = await runAssessment(
      'docstring_faithfulness',
      DocstringPrompt.SYSTEM,
      DocstringPrompt.buildPrompt(fn.name, fn.jsdoc, fn.body),
      DocstringPrompt.PROMPT_VERSION,
      config,
      client
    );
    if (result) results.push(result);
  }

  // Naming coherence — always run
  const namingResult = await runAssessment(
    'naming_coherence',
    NamingPrompt.SYSTEM,
    NamingPrompt.buildPrompt(fn.name, fn.body),
    NamingPrompt.PROMPT_VERSION,
    config,
    client
  );
  if (namingResult) results.push(namingResult);

  // Intent clarity — always run
  const intentResult = await runAssessment(
    'intent_clarity',
    IntentPrompt.SYSTEM,
    IntentPrompt.buildPrompt(fn.name, fn.body),
    IntentPrompt.PROMPT_VERSION,
    config,
    client
  );
  if (intentResult) results.push(intentResult);

  return results;
}

// ─── Competing implementation detection ──────────────────────────────────────

async function detectCompetingImplementations(
  functions: ExtractedFunction[],
  config: LlmConfig,
  client: Anthropic
): Promise<Assessment[]> {
  const results: Assessment[] = [];

  // Compare pairs — limit to avoid O(n²) blowup on large files
  const maxPairs = 10;
  let pairCount = 0;

  for (let i = 0; i < functions.length - 1 && pairCount < maxPairs; i++) {
    for (let j = i + 1; j < functions.length && pairCount < maxPairs; j++) {
      const fn1 = functions[i]!;
      const fn2 = functions[j]!;

      // Quick pre-filter: only compare functions with similar LOC (±50%)
      const loc1 = fn1.body.split('\n').length;
      const loc2 = fn2.body.split('\n').length;
      if (Math.min(loc1, loc2) / Math.max(loc1, loc2) < 0.5) continue;

      const result = await runAssessment(
        'competing_implementation',
        CompetingPrompt.SYSTEM,
        CompetingPrompt.buildPrompt(fn1.name, fn1.body, fn2.name, fn2.body),
        CompetingPrompt.PROMPT_VERSION,
        config,
        client
      );

      if (result && result.severity !== 'ok') {
        results.push(result);
      }

      pairCount++;
    }
  }

  return results;
}

// ─── LLM call wrapper ─────────────────────────────────────────────────────────

function parseSeverity(raw: unknown): 'ok' | 'warn' | 'fail' {
  if (raw === 'ok' || raw === 'fail') return raw;
  return 'warn';
}

function buildAssessment(type: AssessmentType, parsed: Record<string, unknown>): Assessment {
  const linesOfConcern = Array.isArray(parsed.lines_of_concern) ? parsed.lines_of_concern as number[] : [];
  const relatedFiles   = Array.isArray(parsed.related_files)   ? parsed.related_files   as string[] : [];
  return {
    type,
    score:      clamp(parsed.score      ?? 0.5),
    confidence: clamp(parsed.confidence ?? 0.5),
    severity:   parseSeverity(parsed.severity),
    detail:     typeof parsed.detail === 'string' ? parsed.detail : '',
    ...(linesOfConcern.length ? { lines_of_concern: linesOfConcern } : {}),
    ...(relatedFiles.length   ? { related_files:    relatedFiles   } : {}),
  };
}

async function runAssessment(
  type: AssessmentType,
  systemPrompt: string,
  userPrompt: string,
  promptVersion: string,
  config: LlmConfig,
  client: Anthropic
): Promise<Assessment | null> {
  try {
    const response = await client.messages.create({
      model: config.model_file,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const parsed = extractJson(text);

    if (!parsed) {
      logger.debug(`Failed to parse JSON from ${type} assessment`);
      return null;
    }

    return buildAssessment(type, parsed);
  } catch (err) {
    logger.warn(`Assessment ${type} failed: ${(err as Error).message}`);
    return null;
  }
}

// ─── Source extraction ────────────────────────────────────────────────────────

/**
 * Extract function bodies from source code using the line ranges from lizard.
 * Falls back to simple heuristics if metrics aren't available.
 */
function extractFunctions(
  source: string,
  functionMetrics: FunctionMetrics[]
): ExtractedFunction[] {
  const lines = source.split('\n');
  const results: ExtractedFunction[] = [];

  for (const metric of functionMetrics) {
    const start = Math.max(0, metric.line_start - 1);
    const end = Math.min(lines.length, metric.line_end);

    // Look back up to 10 lines for a JSDoc comment
    const jsdoc = extractJsDoc(lines, start);

    const body = lines.slice(start, end).join('\n');

    // Truncate very long functions to keep token count manageable
    const truncated = truncateBody(body, 200);

    results.push({
      name: metric.name,
      jsdoc,
      body: truncated,
      lineStart: metric.line_start,
    });
  }

  return results;
}

function extractJsDoc(lines: string[], functionLineIndex: number): string | null {
  let i = functionLineIndex - 1;

  // Skip blank lines
  while (i >= 0 && lines[i]!.trim() === '') i--;

  if (i < 0 || !lines[i]!.trim().endsWith('*/')) return null;

  // Walk back to find the opening /**
  const end = i;
  while (i >= 0 && !lines[i]!.trim().startsWith('/**')) i--;

  if (i < 0) return null;

  return lines.slice(i, end + 1).join('\n');
}

function truncateBody(body: string, maxLines: number): string {
  const lines = body.split('\n');
  if (lines.length <= maxLines) return body;

  const half = Math.floor(maxLines / 2);
  return [
    ...lines.slice(0, half),
    `  // ... (${lines.length - maxLines} lines truncated) ...`,
    ...lines.slice(lines.length - half),
  ].join('\n');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function extractJson(text: string): Record<string, unknown> | null {
  // Extract JSON from markdown code blocks or bare JSON
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[1]!);
  } catch {
    return null;
  }
}

function clamp(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return isNaN(n) ? 0.5 : Math.max(0, Math.min(1, n));
}
