import type { Snapshot, ReportOptions } from '../types/index.js';
import { loadLatestSnapshot } from '../metrics/index.js';
import { logger } from '../utils/logger.js';

export async function runReport(
  options: ReportOptions,
  cwd: string
): Promise<void> {
  const snapshot = loadLatestSnapshot(cwd);
  if (!snapshot) {
    logger.error('No snapshot found. Run: codehealth scan');
    process.exit(1);
  }

  if (options.agent) {
    printAgentReport(snapshot, options);
    return;
  }

  switch (options.format) {
    case 'json':
      printJsonReport(snapshot, options);
      break;
    case 'markdown':
      printMarkdownReport(snapshot, options);
      break;
    default:
      printTextReport(snapshot, options);
  }
}

// ─── Agent-optimised output ───────────────────────────────────────────────────

function printAgentReport(snapshot: Snapshot, options: ReportOptions): void {
  const { summary, files, agent_assessments } = snapshot;

  const assessmentsByFile = new Map(
    (agent_assessments?.files ?? []).map(f => [f.path, f.assessments])
  );

  // Build priority queue
  const prioritised = files
    .filter(f => f.status === 'red' || f.status === 'amber')
    .sort((a, b) => a.health_score - b.health_score)
    .slice(0, options.worst ?? 20);

  const lines: string[] = [
    'CODEHEALTH AGENT REPORT',
    `Generated: ${snapshot.generated_at}`,
    `Commit: ${snapshot.commit}`,
    '',
    'PRIORITY QUEUE (ordered by remediation priority)',
    '',
  ];

  prioritised.forEach((file, i) => {
    const assessments = assessmentsByFile.get(file.path) ?? [];
    const primary = assessments
      .filter(a => a.severity !== 'ok')
      .sort((a, b) => b.confidence - a.confidence)[0];

    const trendStr = `${file.status}`;
    const confidence = primary?.confidence.toFixed(2) ?? 'n/a';

    lines.push(`${i + 1}. ${file.path}`);
    lines.push(`   Health: ${file.health_score} (${trendStr})`);
    lines.push(`   Confidence: ${confidence}`);

    if (primary) {
      lines.push(`   Primary issue: ${primary.type.replace(/_/g, ' ')}`);
      lines.push(`   Detail: ${wordWrap(primary.detail, 70, '           ')}`);
      if (primary.related_files?.length) {
        lines.push(`   Related: ${primary.related_files.join(', ')}`);
      }
      if (primary.lines_of_concern?.length) {
        lines.push(`   Lines of concern: ${primary.lines_of_concern.join(', ')}`);
      }
    } else {
      const worstSmell = file.smells.sort((a, b) => {
        const order = { fail: 0, warn: 1, ok: 2 };
        return order[a.severity] - order[b.severity];
      })[0];
      if (worstSmell) {
        lines.push(`   Primary issue: ${worstSmell.type.replace(/_/g, ' ')}`);
        lines.push(`   Detail: ${worstSmell.detail}`);
      }
    }

    lines.push(`   Quarantine count: 0`);
    lines.push('');
  });

  lines.push('SUMMARY');
  lines.push(`  Files in queue: ${prioritised.length}`);
  lines.push(`  Total files: ${summary.files_analysed}`);
  lines.push(`  Health score: ${summary.health_score} (${summary.trend})`);

  console.log(lines.join('\n'));
}

// ─── Human text output ────────────────────────────────────────────────────────

function printTextReport(snapshot: Snapshot, options: ReportOptions): void {
  const { summary, modules, files } = snapshot;

  const score = Math.round(summary.health_score * 100);
  const trend = summary.trend === 'improving' ? '↑' : summary.trend === 'degrading' ? '↓' : '→';

  console.log(`\nCodeHealth Report — ${snapshot.repo}`);
  console.log(`Generated: ${new Date(snapshot.generated_at).toLocaleString()}`);
  console.log(`Commit: ${snapshot.commit} ${snapshot.commit_message}`);
  console.log('');
  console.log(`Health: ${score}  ${trend} ${summary.trend}`);
  console.log(`Files: ${summary.green_files} green / ${summary.amber_files} amber / ${summary.red_files} red`);

  if (modules.length > 0) {
    console.log('\nModules:');
    for (const mod of modules) {
      const modScore = Math.round(mod.health_score * 100);
      const modTrend = mod.trend === 'improving' ? '↑' : mod.trend === 'degrading' ? '↓' : '→';
      console.log(`  ${mod.name.padEnd(20)} ${modScore}  ${modTrend} ${mod.trend}`);
      if (mod.plain_summary) {
        console.log(`  ${''.padEnd(20)} ${mod.plain_summary}`);
      }
    }
  }

  const filteredFiles = (options.module
    ? files.filter(f => f.module === options.module)
    : files)
    .sort((a, b) => a.health_score - b.health_score)
    .slice(0, options.worst ?? 10);

  if (filteredFiles.length > 0) {
    console.log('\nWorst files:');
    for (const f of filteredFiles) {
      console.log(`  ${String(Math.round(f.health_score * 100)).padStart(3)}  [${f.status}]  ${f.path}`);
      for (const smell of f.smells.filter(s => s.severity === 'fail').slice(0, 2)) {
        console.log(`         ✖  ${smell.detail}`);
      }
    }
  }
  console.log('');
}

// ─── JSON output ──────────────────────────────────────────────────────────────

function printJsonReport(snapshot: Snapshot, options: ReportOptions): void {
  const output = options.module
    ? { ...snapshot, files: snapshot.files.filter(f => f.module === options.module) }
    : snapshot;

  console.log(JSON.stringify(output, null, 2));
}

// ─── Markdown output ──────────────────────────────────────────────────────────

function printMarkdownReport(snapshot: Snapshot, options: ReportOptions): void {
  const { summary } = snapshot;
  const score = Math.round(summary.health_score * 100);
  const trend = summary.trend === 'improving' ? '↑' : summary.trend === 'degrading' ? '↓' : '→';

  const lines: string[] = [
    `# CodeHealth Report — ${snapshot.repo}`,
    '',
    `**Generated:** ${new Date(snapshot.generated_at).toLocaleString()}  `,
    `**Commit:** \`${snapshot.commit}\` ${snapshot.commit_message}`,
    '',
    `## Summary`,
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Health Score | **${score}** ${trend} |`,
    `| Trend | ${summary.trend} |`,
    `| Files | ${summary.green_files} green / ${summary.amber_files} amber / ${summary.red_files} red |`,
    `| Total LOC | ${summary.total_loc.toLocaleString()} |`,
    ...(summary.coverage != null ? [`| Coverage | ${Math.round(summary.coverage * 100)}% |`] : []),
    '',
  ];

  if (snapshot.modules.length > 0) {
    lines.push('## Modules', '');
    lines.push('| Module | Health | Status | Trend |');
    lines.push('|--------|--------|--------|-------|');
    for (const mod of snapshot.modules) {
      lines.push(`| ${mod.name} | ${Math.round(mod.health_score * 100)} | ${mod.status} | ${mod.trend} |`);
    }
    lines.push('');
  }

  const worstFiles = snapshot.files
    .sort((a, b) => a.health_score - b.health_score)
    .slice(0, options.worst ?? 10);

  if (worstFiles.length > 0) {
    lines.push('## Worst Files', '');
    lines.push('| File | Health | Status | Issues |');
    lines.push('|------|--------|--------|--------|');
    for (const f of worstFiles) {
      const issues = f.smells.filter(s => s.severity !== 'ok').map(s => s.type.replace(/_/g, ' ')).join(', ');
      lines.push(`| \`${f.path}\` | ${Math.round(f.health_score * 100)} | ${f.status} | ${issues} |`);
    }
  }

  console.log(lines.join('\n'));
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function wordWrap(text: string, width: number, indent: string): string {
  const words = text.split(' ');
  const result: string[] = [];
  let line = '';

  for (const word of words) {
    if ((line + word).length > width && line) {
      result.push(line.trimEnd());
      line = indent + word + ' ';
    } else {
      line += word + ' ';
    }
  }
  if (line.trim()) result.push(line.trimEnd());

  return result.join('\n');
}
