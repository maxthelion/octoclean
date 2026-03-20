/**
 * Remediation prioritiser.
 *
 * priority = health_score_inverted
 *          × (1 + normalised_churn_30d)
 *          × assessment_confidence
 *          × (1 − recent_remediation_activity)
 */

import type { FileMetrics, AgentAssessments, Assessment } from '../types/index.js';
import type { QuarantineStore } from '../types/index.js';
import { isQuarantined } from './quarantine.js';

export interface PrioritisedFile {
  file: FileMetrics;
  priority: number;
  primaryAssessment: Assessment | null;
  confidence: number;
  permittedActions: string[];
}

export function prioritiseFiles(
  files: FileMetrics[],
  agentAssessments: AgentAssessments | null,
  quarantine: QuarantineStore,
  minConfidence: number,
  allowedActions: string[],
  maxFiles: number
): PrioritisedFile[] {
  // Build assessment index
  const assessmentsByFile = new Map(
    (agentAssessments?.files ?? []).map(f => [f.path, f.assessments])
  );

  const candidates: PrioritisedFile[] = [];

  for (const file of files) {
    // Skip quarantined files
    if (isQuarantined(file.path, quarantine)) continue;

    // Skip files with no permitted actions applicable
    const assessments = assessmentsByFile.get(file.path) ?? [];
    const actionable = assessments.filter(
      a => a.confidence >= minConfidence && a.severity !== 'ok'
    );

    const confidence = actionable.length > 0
      ? Math.max(...actionable.map(a => a.confidence))
      : 0.5;

    // Only include files that have something actionable or significant mechanical issues
    if (actionable.length === 0 && file.status === 'green') continue;

    const permittedActions = resolvePermittedActions(file, actionable, allowedActions);
    if (permittedActions.length === 0) continue;

    const priority = computePriority(file, confidence);
    const primaryAssessment = actionable.sort((a, b) => b.confidence - a.confidence)[0] ?? null;

    candidates.push({ file, priority, primaryAssessment, confidence, permittedActions });
  }

  return candidates
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxFiles);
}

function computePriority(file: FileMetrics, confidence: number): number {
  const scoreInverted = 1 - file.health_score;
  const normalisedChurn = Math.min(file.churn_30d / 30, 1);

  return scoreInverted
    * (1 + normalisedChurn)
    * confidence;
}

function resolvePermittedActions(
  file: FileMetrics,
  assessments: Assessment[],
  allowedActions: string[]
): string[] {
  const actions = new Set<string>();

  // High fan-in files: restrict to safe actions only
  const highFanIn = file.coupling.fan_in > 5;

  for (const a of assessments) {
    switch (a.type) {
      case 'naming_coherence':
        if (!highFanIn) actions.add('rename_symbol');
        break;
      case 'competing_implementation':
        actions.add('consolidate_duplicate');
        actions.add('extract_function');
        break;
      case 'docstring_faithfulness':
        actions.add('update_docstring');
        break;
      case 'intent_clarity':
        actions.add('extract_function');
        break;
    }
  }

  // Mechanical smells
  if (file.dead_exports > 0) actions.add('remove_dead_export');
  if (file.functions.some(f => f.loc > 80)) actions.add('extract_function');

  // Filter to only allowed actions from config
  return [...actions].filter(a => allowedActions.includes(a));
}
