import type { Snapshot, DiffOptions } from '../types/index.js';
import { resolveSnapshotRef } from '../metrics/index.js';
import { logger } from '../utils/logger.js';

export async function runDiff(options: DiffOptions, cwd: string): Promise<void> {
  const fromSnapshot = resolveSnapshotRef(options.from, cwd);
  const toSnapshot = resolveSnapshotRef(options.to, cwd);

  if (!fromSnapshot) {
    logger.error(`Could not resolve snapshot ref: ${options.from}`);
    process.exit(1);
  }
  if (!toSnapshot) {
    logger.error(`Could not resolve snapshot ref: ${options.to}`);
    process.exit(1);
  }

  printDiff(fromSnapshot, toSnapshot, options.from, options.to);
}

function printDiff(from: Snapshot, to: Snapshot, fromRef: string, toRef: string): void {
  const fromScore = from.summary.health_score;
  const toScore = to.summary.health_score;
  const delta = toScore - fromScore;
  const sign = delta >= 0 ? '+' : '';

  console.log(`\nCodeHealth Diff`);
  console.log(`From: ${fromRef} (${from.generated_at.split('T')[0]}, commit ${from.commit})`);
  console.log(`To:   ${toRef} (${to.generated_at.split('T')[0]}, commit ${to.commit})`);
  console.log('');
  console.log(`Health: ${Math.round(fromScore * 100)} → ${Math.round(toScore * 100)}  (${sign}${Math.round(delta * 100)}pts)`);
  console.log('');

  // Module-level diff
  const moduleMap = new Map(from.modules.map(m => [m.name, m]));
  const moduleChanges: Array<{ name: string; from: number; to: number; delta: number }> = [];

  for (const mod of to.modules) {
    const prev = moduleMap.get(mod.name);
    if (!prev) continue;
    moduleChanges.push({
      name: mod.name,
      from: prev.health_score,
      to: mod.health_score,
      delta: mod.health_score - prev.health_score,
    });
  }

  if (moduleChanges.length > 0) {
    console.log('Modules:');
    for (const c of moduleChanges.sort((a, b) => a.delta - b.delta)) {
      const sign = c.delta >= 0 ? '+' : '';
      const arrow = c.delta > 0.02 ? '↑' : c.delta < -0.02 ? '↓' : '→';
      console.log(`  ${arrow} ${c.name.padEnd(20)} ${Math.round(c.from * 100)} → ${Math.round(c.to * 100)}  (${sign}${Math.round(c.delta * 100)})`);
    }
    console.log('');
  }

  // File-level diff — show most improved and most degraded
  const fromFileMap = new Map(from.files.map(f => [f.path, f]));
  const fileDeltas: Array<{ path: string; from: number; to: number; delta: number }> = [];

  for (const file of to.files) {
    const prev = fromFileMap.get(file.path);
    if (!prev) continue;
    const delta = file.health_score - prev.health_score;
    if (Math.abs(delta) >= 0.02) {
      fileDeltas.push({ path: file.path, from: prev.health_score, to: file.health_score, delta });
    }
  }

  const degraded = fileDeltas.filter(f => f.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
  const improved = fileDeltas.filter(f => f.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);

  if (degraded.length > 0) {
    console.log('Most degraded:');
    for (const f of degraded) {
      console.log(`  ↓ ${f.path.padEnd(50)} ${Math.round(f.from * 100)} → ${Math.round(f.to * 100)}  (${Math.round(f.delta * 100)})`);
    }
    console.log('');
  }

  if (improved.length > 0) {
    console.log('Most improved:');
    for (const f of improved) {
      console.log(`  ↑ ${f.path.padEnd(50)} ${Math.round(f.from * 100)} → ${Math.round(f.to * 100)}  (+${Math.round(f.delta * 100)})`);
    }
    console.log('');
  }

  // Files added/removed
  const newFiles = to.files.filter(f => !fromFileMap.has(f.path));
  const removedFiles = from.files.filter(f => !new Set(to.files.map(x => x.path)).has(f.path));

  if (newFiles.length > 0) {
    console.log(`New files: ${newFiles.length}`);
    for (const f of newFiles.slice(0, 5)) {
      console.log(`  + ${f.path} (health: ${Math.round(f.health_score * 100)})`);
    }
    console.log('');
  }

  if (removedFiles.length > 0) {
    console.log(`Removed files: ${removedFiles.length}`);
    for (const f of removedFiles.slice(0, 5)) {
      console.log(`  - ${f.path}`);
    }
    console.log('');
  }
}
