/**
 * File selector — prioritises which files get LLM assessment tonight,
 * up to max_files_per_night.
 *
 * Priority factors:
 *  - Low health score (high score_inverted)
 *  - High churn (changes frequently)
 *  - Not recently assessed
 *  - Has mechanical smells (fail > warn > ok)
 */

import type { FileMetrics, AgentAssessments } from '../types/index.js';

export interface SelectionCandidate {
  file: FileMetrics;
  priority: number;
}

/**
 * Select files for LLM assessment, ordered by priority.
 */
export function selectFilesForAssessment(
  files: FileMetrics[],
  maxFiles: number,
  previousAssessments: AgentAssessments | null
): FileMetrics[] {
  // Build a set of recently assessed file paths
  const recentlyAssessed = new Set(
    previousAssessments?.files.map(f => f.path) ?? []
  );

  const candidates: SelectionCandidate[] = files
    .filter(f => f.functions.length > 0) // skip files with no parseable functions
    .map(file => ({
      file,
      priority: computePriority(file, recentlyAssessed),
    }))
    .sort((a, b) => b.priority - a.priority);

  return candidates.slice(0, maxFiles).map(c => c.file);
}

function computePriority(file: FileMetrics, recentlyAssessed: Set<string>): number {
  const scoreInverted = 1 - file.health_score;

  // Normalise churn to 0–1 over a 20-commit window
  const normalisedChurn = Math.min(file.churn_30d / 20, 1);

  // Smell severity bonus
  const failCount = file.smells.filter(s => s.severity === 'fail').length;
  const warnCount = file.smells.filter(s => s.severity === 'warn').length;
  const smellBonus = Math.min((failCount * 0.1 + warnCount * 0.05), 0.3);

  // Recency penalty — slightly deprioritise recently assessed files
  const recencyPenalty = recentlyAssessed.has(file.path) ? 0.2 : 0;

  return (scoreInverted * 0.5)
    + (normalisedChurn * 0.3)
    + smellBonus
    - recencyPenalty;
}
