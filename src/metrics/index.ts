/**
 * Snapshot management — create, save, load, and index CodeHealth snapshots.
 */

import type {
  Snapshot,
  IndexFile,
  IndexEntry,
  FileMetrics,
  ModuleMetrics,
  AgentAssessments,
  DriftSignals,
  SnapshotSummary,
} from '../types/index.js';
import {
  writeMultipleToMetricsBranch,
  readFromMetricsBranch,
  pushMetricsBranch,
  METRICS_DIR,
  INDEX_FILE,
} from './branch.js';
import { getRepoName } from '../utils/git.js';
import { logger } from '../utils/logger.js';

// ─── Build snapshot ───────────────────────────────────────────────────────────

export function buildSnapshot(params: {
  commit: string;
  commitMessage: string;
  cwd: string;
  summary: SnapshotSummary;
  modules: ModuleMetrics[];
  files: FileMetrics[];
  drift_signals: DriftSignals;
  agent_assessments: AgentAssessments | null;
}): Snapshot {
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    commit: params.commit,
    commit_message: params.commitMessage,
    repo: getRepoName(params.cwd),
    summary: params.summary,
    modules: params.modules,
    files: params.files,
    drift_signals: params.drift_signals,
    agent_assessments: params.agent_assessments,
  };
}

// ─── Save snapshot ────────────────────────────────────────────────────────────

export function saveSnapshot(snapshot: Snapshot, cwd: string, pushMetrics: boolean): void {
  const timestamp = snapshot.generated_at;
  const snapshotPath = `${METRICS_DIR}/${timestamp}.json`;
  const snapshotJson = JSON.stringify(snapshot, null, 2);

  // Load current index
  const index = loadIndex(cwd) ?? createIndex(snapshot.repo);

  // Update index
  const entry: IndexEntry = {
    timestamp,
    commit: snapshot.commit,
    file: snapshotPath,
    summary: {
      health_score: snapshot.summary.health_score,
      trend: snapshot.summary.trend,
      red_files: snapshot.summary.red_files,
      amber_files: snapshot.summary.amber_files,
      green_files: snapshot.summary.green_files,
    },
  };

  index.latest = snapshotPath;
  index.snapshots.unshift(entry); // newest first

  const indexJson = JSON.stringify(index, null, 2);

  // Write both snapshot and index atomically
  writeMultipleToMetricsBranch(
    [
      { path: snapshotPath, content: snapshotJson },
      { path: INDEX_FILE, content: indexJson },
    ],
    `chore: add snapshot ${timestamp} (health: ${snapshot.summary.health_score})`,
    cwd
  );

  logger.success(`Snapshot saved: ${snapshotPath}`);

  if (pushMetrics) {
    pushMetricsBranch(cwd);
  }
}

// ─── Load snapshot ────────────────────────────────────────────────────────────

export function loadLatestSnapshot(cwd: string): Snapshot | null {
  const index = loadIndex(cwd);
  if (!index || !index.latest) return null;

  return loadSnapshot(index.latest, cwd);
}

export function loadSnapshot(snapshotPath: string, cwd: string): Snapshot | null {
  const raw = readFromMetricsBranch(snapshotPath, cwd);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as Snapshot;
  } catch {
    logger.warn(`Failed to parse snapshot at ${snapshotPath}`);
    return null;
  }
}

export function loadSnapshotByDate(date: string, cwd: string): Snapshot | null {
  const index = loadIndex(cwd);
  if (!index) return null;

  const target = new Date(date).getTime();
  const entry = index.snapshots.find(s => {
    const diff = Math.abs(new Date(s.timestamp).getTime() - target);
    return diff < 24 * 60 * 60 * 1000; // within 24 hours
  });

  if (!entry) return null;
  return loadSnapshot(entry.file, cwd);
}

// ─── Index ────────────────────────────────────────────────────────────────────

export function loadIndex(cwd: string): IndexFile | null {
  const raw = readFromMetricsBranch(INDEX_FILE, cwd);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as IndexFile;
  } catch {
    return null;
  }
}

function createIndex(repo: string): IndexFile {
  return {
    schema_version: 1,
    repo,
    latest: '',
    snapshots: [],
  };
}

// ─── Diff helpers ─────────────────────────────────────────────────────────────

export function resolveSnapshotRef(ref: string, cwd: string): Snapshot | null {
  // Try as ISO date
  if (/^\d{4}-\d{2}-\d{2}/.test(ref)) {
    return loadSnapshotByDate(ref, cwd);
  }

  // Try as git ref — find snapshot by commit hash
  const index = loadIndex(cwd);
  if (!index) return null;

  const entry = index.snapshots.find(s => s.commit.startsWith(ref));
  if (entry) return loadSnapshot(entry.file, cwd);

  // HEAD or HEAD~N
  if (ref === 'HEAD') return loadLatestSnapshot(cwd);

  return null;
}
