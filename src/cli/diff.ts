import type { Snapshot, DiffOptions, FileMetrics, ModuleMetrics } from '../types/index.js';
import { resolveSnapshotRef } from '../metrics/index.js';
import { logger } from '../utils/logger.js';

export async function runDiff(options: DiffOptions, cwd: string): Promise<void> {
  const fromSnapshot = resolveSnapshotRef(options.from, cwd);
  const toSnapshot   = resolveSnapshotRef(options.to,   cwd);

  if (!fromSnapshot) { logger.error(`Could not resolve snapshot ref: ${options.from}`); process.exit(1); }
  if (!toSnapshot)   { logger.error(`Could not resolve snapshot ref: ${options.to}`);   process.exit(1); }

  printDiff(fromSnapshot, toSnapshot, options.from, options.to);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScoreDelta { path?: string; name?: string; from: number; to: number; delta: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreDelta(from: number, to: number): number {
  return Math.round((to - from) * 100);
}

function deltaLine(arrow: string, label: string, from: number, to: number, delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `  ${arrow} ${label.padEnd(50)} ${Math.round(from * 100)} → ${Math.round(to * 100)}  (${sign}${delta})`;
}

function computeFileDeltas(from: Snapshot, to: Snapshot): ScoreDelta[] {
  const fromMap = new Map(from.files.map(f => [f.path, f]));
  return to.files
    .map(f => ({ path: f.path, from: fromMap.get(f.path)?.health_score ?? -1, to: f.health_score, delta: 0 }))
    .filter(f => f.from !== -1)
    .map(f => ({ ...f, delta: scoreDelta(f.from, f.to) }))
    .filter(f => Math.abs(f.delta) >= 2);
}

function computeModuleDeltas(from: Snapshot, to: Snapshot): ScoreDelta[] {
  const fromMap = new Map(from.modules.map(m => [m.name, m]));
  return to.modules
    .filter(m => fromMap.has(m.name))
    .map(m => ({
      name: m.name,
      from: fromMap.get(m.name)!.health_score,
      to: m.health_score,
      delta: scoreDelta(fromMap.get(m.name)!.health_score, m.health_score),
    }));
}

function printSectionHeader(title: string): void {
  console.log(title);
}

function printDeltas(deltas: ScoreDelta[], direction: 'degraded' | 'improved', limit = 5): void {
  const filtered = direction === 'degraded'
    ? deltas.filter(d => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, limit)
    : deltas.filter(d => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, limit);

  if (filtered.length === 0) return;

  const title = direction === 'degraded' ? 'Most degraded:' : 'Most improved:';
  console.log(title);
  for (const d of filtered) {
    const arrow = direction === 'degraded' ? '↓' : '↑';
    console.log(deltaLine(arrow, d.path ?? d.name ?? '', d.from, d.to, d.delta));
  }
  console.log('');
}

function printAddedRemoved(from: Snapshot, to: Snapshot): void {
  const toPathSet = new Set(to.files.map(f => f.path));
  const added   = to.files.filter(f => !new Map(from.files.map(x => [x.path, x])).has(f.path));
  const removed = from.files.filter(f => !toPathSet.has(f.path));

  if (added.length > 0) {
    console.log(`New files: ${added.length}`);
    added.slice(0, 5).forEach(f => console.log(`  + ${f.path} (health: ${Math.round(f.health_score * 100)})`));
    console.log('');
  }
  if (removed.length > 0) {
    console.log(`Removed files: ${removed.length}`);
    removed.slice(0, 5).forEach(f => console.log(`  - ${f.path}`));
    console.log('');
  }
}

// ─── Main print ───────────────────────────────────────────────────────────────

function printDiff(from: Snapshot, to: Snapshot, fromRef: string, toRef: string): void {
  const overallDelta = scoreDelta(from.summary.health_score, to.summary.health_score);
  const sign = overallDelta >= 0 ? '+' : '';

  console.log(`\nCodeHealth Diff`);
  console.log(`From: ${fromRef} (${from.generated_at.split('T')[0]}, commit ${from.commit})`);
  console.log(`To:   ${toRef} (${to.generated_at.split('T')[0]}, commit ${to.commit})`);
  console.log('');
  console.log(`Health: ${Math.round(from.summary.health_score * 100)} → ${Math.round(to.summary.health_score * 100)}  (${sign}${overallDelta}pts)`);
  console.log('');

  const moduleDeltas = computeModuleDeltas(from, to);
  if (moduleDeltas.length > 0) {
    console.log('Modules:');
    for (const d of moduleDeltas.sort((a, b) => a.delta - b.delta)) {
      const arrow = d.delta > 2 ? '↑' : d.delta < -2 ? '↓' : '→';
      console.log(deltaLine(arrow, d.name ?? '', d.from, d.to, d.delta));
    }
    console.log('');
  }

  const fileDeltas = computeFileDeltas(from, to);
  printDeltas(fileDeltas, 'degraded');
  printDeltas(fileDeltas, 'improved');
  printAddedRemoved(from, to);
}
