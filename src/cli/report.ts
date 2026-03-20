import type { Snapshot, ReportOptions, FileMetrics, Assessment, Smell } from '../types/index.js';
import { loadLatestSnapshot } from '../metrics/index.js';
import { logger } from '../utils/logger.js';

export async function runReport(options: ReportOptions, cwd: string): Promise<void> {
  const snapshot = loadLatestSnapshot(cwd);
  if (!snapshot) {
    logger.error('No snapshot found. Run: codehealth scan');
    process.exit(1);
  }

  if (options.agent)          return void printAgentReport(snapshot, options);
  if (options.format === 'json')     return void printJsonReport(snapshot, options);
  if (options.format === 'markdown') return void printMarkdownReport(snapshot, options);
  printTextReport(snapshot, options);
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function trendArrow(t: string): string {
  return t === 'improving' ? '↑' : t === 'degrading' ? '↓' : '→';
}

function worstSmell(smells: Smell[]): Smell | undefined {
  return [...smells].sort((a, b) => {
    const order = { fail: 0, warn: 1, ok: 2 } as const;
    return order[a.severity] - order[b.severity];
  })[0];
}

function primaryAssessment(assessments: Assessment[]): Assessment | undefined {
  return assessments
    .filter(a => a.severity !== 'ok')
    .sort((a, b) => b.confidence - a.confidence)[0];
}

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

function filterAndSort(snapshot: Snapshot, options: ReportOptions): FileMetrics[] {
  return (options.module ? snapshot.files.filter(f => f.module === options.module) : snapshot.files)
    .sort((a, b) => a.health_score - b.health_score)
    .slice(0, options.worst ?? 10);
}

// ─── Agent-optimised output ───────────────────────────────────────────────────

function agentFileEntry(
  file: FileMetrics,
  index: number,
  assessments: Assessment[]
): string[] {
  const primary = primaryAssessment(assessments);
  const lines: string[] = [
    `${index + 1}. ${file.path}`,
    `   Health: ${file.health_score} (${file.status})`,
    `   Confidence: ${primary?.confidence.toFixed(2) ?? 'n/a'}`,
  ];

  if (primary) {
    lines.push(`   Primary issue: ${primary.type.replace(/_/g, ' ')}`);
    lines.push(`   Detail: ${wordWrap(primary.detail, 70, '           ')}`);
    if (primary.related_files?.length)    lines.push(`   Related: ${primary.related_files.join(', ')}`);
    if (primary.lines_of_concern?.length) lines.push(`   Lines of concern: ${primary.lines_of_concern.join(', ')}`);
  } else {
    const smell = worstSmell(file.smells);
    if (smell) {
      lines.push(`   Primary issue: ${smell.type.replace(/_/g, ' ')}`);
      lines.push(`   Detail: ${smell.detail}`);
    }
  }

  lines.push(`   Quarantine count: 0`, '');
  return lines;
}

function printAgentReport(snapshot: Snapshot, options: ReportOptions): void {
  const assessmentsByFile = new Map(
    (snapshot.agent_assessments?.files ?? []).map(f => [f.path, f.assessments])
  );

  const prioritised = snapshot.files
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
    ...prioritised.flatMap((file, i) =>
      agentFileEntry(file, i, assessmentsByFile.get(file.path) ?? [])
    ),
    'SUMMARY',
    `  Files in queue: ${prioritised.length}`,
    `  Total files: ${snapshot.summary.files_analysed}`,
    `  Health score: ${snapshot.summary.health_score} (${snapshot.summary.trend})`,
  ];

  console.log(lines.join('\n'));
}

// ─── Human text output ────────────────────────────────────────────────────────

function printTextReport(snapshot: Snapshot, options: ReportOptions): void {
  const { summary, modules } = snapshot;
  const score = Math.round(summary.health_score * 100);

  console.log(`\nCodeHealth Report — ${snapshot.repo}`);
  console.log(`Generated: ${new Date(snapshot.generated_at).toLocaleString()}`);
  console.log(`Commit: ${snapshot.commit} ${snapshot.commit_message}`);
  console.log('');
  console.log(`Health: ${score}  ${trendArrow(summary.trend)} ${summary.trend}`);
  console.log(`Files: ${summary.green_files} green / ${summary.amber_files} amber / ${summary.red_files} red`);

  if (modules.length > 0) {
    console.log('\nModules:');
    for (const mod of modules) {
      console.log(`  ${mod.name.padEnd(20)} ${Math.round(mod.health_score * 100)}  ${trendArrow(mod.trend)} ${mod.trend}`);
      if (mod.plain_summary) console.log(`  ${''.padEnd(20)} ${mod.plain_summary}`);
    }
  }

  const files = filterAndSort(snapshot, options);
  if (files.length > 0) {
    console.log('\nWorst files:');
    for (const f of files) {
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

function markdownSummaryTable(snapshot: Snapshot): string[] {
  const { summary } = snapshot;
  const score = Math.round(summary.health_score * 100);
  const rows = [
    `| Health Score | **${score}** ${trendArrow(summary.trend)} |`,
    `| Trend | ${summary.trend} |`,
    `| Files | ${summary.green_files} green / ${summary.amber_files} amber / ${summary.red_files} red |`,
    `| Total LOC | ${summary.total_loc.toLocaleString()} |`,
    ...(summary.coverage != null ? [`| Coverage | ${Math.round(summary.coverage * 100)}% |`] : []),
  ];
  return ['## Summary', '', '| Metric | Value |', '|--------|-------|', ...rows, ''];
}

function markdownModulesTable(snapshot: Snapshot): string[] {
  if (snapshot.modules.length === 0) return [];
  return [
    '## Modules', '',
    '| Module | Health | Status | Trend |',
    '|--------|--------|--------|-------|',
    ...snapshot.modules.map(m =>
      `| ${m.name} | ${Math.round(m.health_score * 100)} | ${m.status} | ${m.trend} |`
    ),
    '',
  ];
}

function markdownWorstFilesTable(snapshot: Snapshot, options: ReportOptions): string[] {
  const files = filterAndSort(snapshot, options);
  if (files.length === 0) return [];
  return [
    '## Worst Files', '',
    '| File | Health | Status | Issues |',
    '|------|--------|--------|--------|',
    ...files.map(f => {
      const issues = f.smells.filter(s => s.severity !== 'ok').map(s => s.type.replace(/_/g, ' ')).join(', ');
      return `| \`${f.path}\` | ${Math.round(f.health_score * 100)} | ${f.status} | ${issues} |`;
    }),
  ];
}

function printMarkdownReport(snapshot: Snapshot, options: ReportOptions): void {
  const lines = [
    `# CodeHealth Report — ${snapshot.repo}`,
    '',
    `**Generated:** ${new Date(snapshot.generated_at).toLocaleString()}  `,
    `**Commit:** \`${snapshot.commit}\` ${snapshot.commit_message}`,
    '',
    ...markdownSummaryTable(snapshot),
    ...markdownModulesTable(snapshot),
    ...markdownWorstFilesTable(snapshot, options),
  ];
  console.log(lines.join('\n'));
}
