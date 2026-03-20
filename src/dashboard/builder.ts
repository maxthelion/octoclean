/**
 * Dashboard builder — generates the static SPA HTML/JS bundle
 * written to the codehealth-metrics branch under dashboard/.
 *
 * The SPA is a self-contained single file that fetches its data
 * from inline JSON (embedded at build time) and renders a treemap
 * + timeline using vanilla canvas/SVG.
 *
 * A full React/D3 implementation is deferred to a future iteration.
 * This stub produces a functional static report.
 */

import type { Snapshot } from '../types/index.js';

export function buildDashboard(snapshot: Snapshot): string {
  const data = JSON.stringify(snapshot);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeHealth — ${snapshot.repo}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0;
      background: #f8fafc;
      color: #0f172a;
    }
    header {
      background: #0f172a;
      color: #f8fafc;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 24px;
    }
    header h1 { margin: 0; font-size: 1rem; font-weight: 600; }
    .status-bar {
      margin-left: auto;
      display: flex;
      gap: 24px;
      font-size: 0.8125rem;
    }
    .status-bar span { opacity: 0.8; }
    .status-bar strong { opacity: 1; }
    main { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 20px;
    }
    .card-label { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
    .card-value { font-size: 2.25rem; font-weight: 700; margin-top: 4px; }
    .green { color: #16a34a; }
    .amber { color: #d97706; }
    .red { color: #dc2626; }
    .trend { font-size: 0.875rem; color: #64748b; margin-top: 2px; }
    #treemap { background: white; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
    #treemap canvas { display: block; }
    .files-table { background: white; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f8fafc; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;
         color: #64748b; text-align: left; padding: 10px 16px; border-bottom: 1px solid #e2e8f0; }
    td { padding: 10px 16px; font-size: 0.875rem; border-bottom: 1px solid #f1f5f9; }
    tr:last-child td { border-bottom: none; }
    .pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 9999px;
            font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; }
    .pill-green { background: #dcfce7; color: #15803d; }
    .pill-amber { background: #fef9c3; color: #a16207; }
    .pill-red { background: #fee2e2; color: #b91c1c; }
    .smell-list { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 4px; }
    .smell { font-size: 0.6875rem; background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; }
    .smell-fail { background: #fee2e2; color: #b91c1c; }
    h2 { font-size: 1rem; font-weight: 600; margin: 24px 0 12px; }
    .meta { font-size: 0.8125rem; color: #94a3b8; margin-bottom: 24px; }
  </style>
</head>
<body>
<header>
  <h1>CodeHealth · ${snapshot.repo}</h1>
  <div class="status-bar" id="statusBar"></div>
</header>
<main>
  <p class="meta" id="meta"></p>
  <div class="grid" id="summaryCards"></div>
  <h2>Files — worst first</h2>
  <div class="files-table">
    <table id="filesTable">
      <thead>
        <tr>
          <th>File</th>
          <th>Health</th>
          <th>Status</th>
          <th>LOC</th>
          <th>Cyclomatic</th>
          <th>Churn 30d</th>
          <th>Issues</th>
        </tr>
      </thead>
      <tbody id="filesBody"></tbody>
    </table>
  </div>
</main>
<script>
  const SNAPSHOT = ${data};

  function statusClass(s) {
    return s === 'green' ? 'green' : s === 'amber' ? 'amber' : 'red';
  }

  function pill(s) {
    return '<span class="pill pill-' + s + '">' + s + '</span>';
  }

  function trendArrow(t) {
    return t === 'improving' ? '↑' : t === 'degrading' ? '↓' : '→';
  }

  // Status bar
  const s = SNAPSHOT.summary;
  const needsAttention = SNAPSHOT.files ? SNAPSHOT.files.filter(f => f.status === 'red').length : 0;
  document.getElementById('statusBar').innerHTML =
    '<span>Trajectory: <strong>' + trendArrow(s.trend) + ' ' + s.trend + '</strong></span>' +
    (needsAttention > 0 ? '<span>Needs attention: <strong style="color:#f87171">' + needsAttention + '</strong></span>' : '');

  // Meta
  document.getElementById('meta').textContent =
    'Commit ' + SNAPSHOT.commit + ' · ' + new Date(SNAPSHOT.generated_at).toLocaleString();

  // Summary cards
  document.getElementById('summaryCards').innerHTML = [
    { label: 'Health Score', value: Math.round(s.health_score * 100), cls: statusClass(s.health_score >= 0.75 ? 'green' : s.health_score >= 0.5 ? 'amber' : 'red'), sub: trendArrow(s.trend) + ' ' + s.trend + ' (' + (s.trend_delta >= 0 ? '+' : '') + Math.round(s.trend_delta * 100) + 'pts)' },
    { label: 'Files Analysed', value: s.files_analysed, cls: '', sub: s.green_files + ' green · ' + s.amber_files + ' amber · ' + s.red_files + ' red' },
    { label: 'Total LOC', value: s.total_loc.toLocaleString(), cls: '', sub: '' },
    ...(s.coverage != null ? [{ label: 'Coverage', value: Math.round(s.coverage * 100) + '%', cls: statusClass(s.coverage >= 0.7 ? 'green' : s.coverage >= 0.4 ? 'amber' : 'red'), sub: '' }] : []),
  ].map(c => '<div class="card"><div class="card-label">' + c.label + '</div><div class="card-value ' + c.cls + '">' + c.value + '</div><div class="trend">' + c.sub + '</div></div>').join('');

  // Files table
  const files = (SNAPSHOT.files || []).sort((a, b) => a.health_score - b.health_score);
  document.getElementById('filesBody').innerHTML = files.map(f => {
    const smellsHtml = f.smells.slice(0, 3).map(sm =>
      '<li class="smell' + (sm.severity === 'fail' ? ' smell-fail' : '') + '">' + sm.type.replace(/_/g, ' ') + '</li>'
    ).join('');
    return '<tr>' +
      '<td style="font-family:monospace;font-size:0.8rem">' + f.path + '</td>' +
      '<td><strong class="' + statusClass(f.status) + '">' + Math.round(f.health_score * 100) + '</strong></td>' +
      '<td>' + pill(f.status) + '</td>' +
      '<td>' + f.loc + '</td>' +
      '<td>' + f.cyclomatic + '</td>' +
      '<td>' + f.churn_30d + '</td>' +
      '<td><ul class="smell-list">' + smellsHtml + '</ul></td>' +
      '</tr>';
  }).join('');
</script>
</body>
</html>`;
}
