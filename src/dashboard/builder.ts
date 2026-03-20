/**
 * Dashboard builder — generates the static SPA HTML/JS bundle
 * written to the codehealth-metrics branch under dashboard/.
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
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #f8fafc;
      --surface: #ffffff;
      --border: #e2e8f0;
      --border-light: #f1f5f9;
      --text: #0f172a;
      --text-muted: #64748b;
      --text-faint: #94a3b8;
      --green: #16a34a;
      --green-bg: #dcfce7;
      --amber: #d97706;
      --amber-bg: #fef9c3;
      --red: #dc2626;
      --red-bg: #fee2e2;
      --blue: #2563eb;
      --panel-width: 560px;
      --header-h: 52px;
    }

    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
      line-height: 1.5;
    }

    /* ── Header ── */
    header {
      position: sticky;
      top: 0;
      z-index: 10;
      height: var(--header-h);
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      align-items: center;
      padding: 0 20px;
      gap: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    header h1 { font-size: 0.9375rem; font-weight: 600; white-space: nowrap; }
    .header-meta { font-size: 0.75rem; color: #94a3b8; }
    .status-bar { margin-left: auto; display: flex; gap: 20px; font-size: 0.8125rem; align-items: center; }
    .status-bar span { color: #94a3b8; }
    .status-bar strong { color: #f8fafc; }
    .status-attention { color: #f87171 !important; font-weight: 700; }

    /* ── Layout ── */
    .layout { display: flex; min-height: calc(100vh - var(--header-h)); }
    main {
      flex: 1;
      min-width: 0;
      padding: 20px;
      transition: margin-right 0.25s ease;
    }
    main.panel-open { margin-right: var(--panel-width); }

    /* ── Summary cards ── */
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px 18px;
    }
    .card-label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
    .card-value { font-size: 2rem; font-weight: 700; margin-top: 2px; line-height: 1.1; }
    .card-sub { font-size: 0.75rem; color: var(--text-muted); margin-top: 3px; }
    .c-green { color: var(--green); }
    .c-amber { color: var(--amber); }
    .c-red   { color: var(--red); }

    /* ── Table ── */
    .table-wrap {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }
    .table-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    .table-header h2 { font-size: 0.875rem; font-weight: 600; }
    .table-header-meta { font-size: 0.75rem; color: var(--text-muted); }
    table { width: 100%; border-collapse: collapse; }
    th {
      background: #f8fafc;
      font-size: 0.6875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      text-align: left;
      padding: 9px 14px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    td { padding: 9px 14px; border-bottom: 1px solid var(--border-light); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    tbody tr {
      cursor: pointer;
      transition: background 0.1s;
    }
    tbody tr:hover { background: #f8fafc; }
    tbody tr.active { background: #eff6ff; }
    .file-path { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.8125rem; }
    .score-num { font-weight: 700; font-size: 0.9375rem; }

    /* ── Pills ── */
    .pill {
      display: inline-flex; align-items: center;
      padding: 2px 7px; border-radius: 9999px;
      font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    }
    .pill-green { background: var(--green-bg); color: #15803d; }
    .pill-amber { background: var(--amber-bg); color: #a16207; }
    .pill-red   { background: var(--red-bg);   color: #b91c1c; }

    /* ── Smell tags ── */
    .smells { display: flex; flex-wrap: wrap; gap: 4px; }
    .smell-tag {
      font-size: 0.625rem; padding: 1px 6px; border-radius: 4px;
      background: #f1f5f9; color: #475569;
      white-space: nowrap;
    }
    .smell-tag.fail { background: var(--red-bg); color: #b91c1c; }
    .smell-tag.warn { background: var(--amber-bg); color: #a16207; }

    /* ── Detail panel ── */
    .detail-panel {
      position: fixed;
      top: var(--header-h);
      right: 0;
      width: var(--panel-width);
      height: calc(100vh - var(--header-h));
      background: var(--surface);
      border-left: 1px solid var(--border);
      overflow-y: auto;
      transform: translateX(100%);
      transition: transform 0.25s ease;
      z-index: 20;
      display: flex;
      flex-direction: column;
    }
    .detail-panel.open { transform: translateX(0); }

    .panel-header {
      position: sticky;
      top: 0;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 14px 18px;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      z-index: 1;
    }
    .panel-header-content { flex: 1; min-width: 0; }
    .panel-file-path {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.8125rem;
      color: var(--text);
      word-break: break-all;
      line-height: 1.4;
    }
    .panel-header-meta { font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; display: flex; gap: 10px; flex-wrap: wrap; }
    .panel-close {
      background: none; border: none; cursor: pointer;
      color: var(--text-muted); font-size: 1.25rem; line-height: 1;
      padding: 2px 4px; border-radius: 4px; flex-shrink: 0;
    }
    .panel-close:hover { background: var(--border-light); color: var(--text); }

    .panel-body { padding: 16px 18px; flex: 1; }

    .panel-section { margin-bottom: 20px; }
    .panel-section-title {
      font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--text-muted); margin-bottom: 10px; font-weight: 600;
    }

    /* Metrics grid in panel */
    .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .metric-cell {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 9px 12px;
    }
    .metric-cell-label { font-size: 0.6875rem; color: var(--text-muted); }
    .metric-cell-value { font-size: 1.125rem; font-weight: 700; margin-top: 1px; }
    .metric-cell-value.warn { color: var(--amber); }
    .metric-cell-value.fail { color: var(--red); }

    /* Smells in panel */
    .smell-row {
      display: flex; align-items: flex-start; gap: 8px;
      padding: 8px 0; border-bottom: 1px solid var(--border-light);
      font-size: 0.8125rem;
    }
    .smell-row:last-child { border-bottom: none; }
    .smell-icon { flex-shrink: 0; margin-top: 1px; }
    .smell-detail { color: var(--text-muted); font-size: 0.75rem; }

    /* Functions table in panel */
    .fn-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
    .fn-table th {
      font-size: 0.625rem; background: none; padding: 5px 8px;
      border-bottom: 1px solid var(--border); color: var(--text-muted);
    }
    .fn-table td { padding: 6px 8px; border-bottom: 1px solid var(--border-light); }
    .fn-table tr:last-child td { border-bottom: none; }
    .fn-name { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.75rem; }
    .fn-loc-bar-wrap { width: 60px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; }
    .fn-loc-bar { height: 100%; border-radius: 3px; background: var(--blue); }
    .fn-loc-bar.warn { background: var(--amber); }
    .fn-loc-bar.fail { background: var(--red); }

    /* LLM assessments in panel */
    .assessment-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 8px;
    }
    .assessment-card.fail { border-color: #fca5a5; background: #fff8f8; }
    .assessment-card.warn { border-color: #fde68a; background: #fffdf0; }
    .assessment-card.ok   { border-color: #bbf7d0; background: #f0fff4; }
    .assessment-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .assessment-type { font-size: 0.75rem; font-weight: 600; text-transform: capitalize; }
    .assessment-conf { font-size: 0.6875rem; color: var(--text-muted); margin-left: auto; }
    .assessment-detail { font-size: 0.8125rem; color: var(--text-muted); line-height: 1.5; }
    .assessment-lines { font-size: 0.6875rem; color: var(--blue); margin-top: 5px; font-family: monospace; }

    /* Score arc */
    .score-arc-wrap { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
    .score-arc { position: relative; width: 72px; height: 72px; flex-shrink: 0; }
    .score-arc svg { transform: rotate(-90deg); }
    .score-arc-num {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-size: 1.25rem; font-weight: 700;
    }
    .score-arc-info { flex: 1; }
    .score-arc-status { font-size: 0.8125rem; color: var(--text-muted); }
    .score-arc-module { font-size: 0.75rem; color: var(--text-faint); margin-top: 2px; }

    /* Empty state */
    .empty { padding: 32px 0; text-align: center; color: var(--text-muted); font-size: 0.875rem; }
  </style>
</head>
<body>

<header>
  <h1>CodeHealth · ${snapshot.repo}</h1>
  <span class="header-meta" id="headerMeta"></span>
  <div class="status-bar" id="statusBar"></div>
</header>

<div class="layout">
  <main id="main">
    <div class="cards" id="cards"></div>
    <div class="table-wrap">
      <div class="table-header">
        <h2>Files <span id="fileCount" style="color:var(--text-muted);font-weight:400"></span></h2>
        <span class="table-header-meta">Sorted by health score · click a row to inspect</span>
      </div>
      <table>
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

  <!-- Detail panel -->
  <aside class="detail-panel" id="detailPanel">
    <div class="panel-header" id="panelHeader"></div>
    <div class="panel-body" id="panelBody"></div>
  </aside>
</div>

<script>
  const SNAPSHOT = ${data};

  // ── Helpers ────────────────────────────────────────────────────────────────

  function scoreColour(s) {
    return s >= 0.75 ? 'c-green' : s >= 0.5 ? 'c-amber' : 'c-red';
  }
  function statusColour(s) {
    return s === 'green' ? 'c-green' : s === 'amber' ? 'c-amber' : 'c-red';
  }
  function pill(s) {
    return '<span class="pill pill-' + s + '">' + s + '</span>';
  }
  function trendArrow(t) {
    return t === 'improving' ? '↑' : t === 'degrading' ? '↓' : '→';
  }
  function pct(n) {
    return n != null ? Math.round(n * 100) + '%' : '—';
  }
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Header ─────────────────────────────────────────────────────────────────

  const s = SNAPSHOT.summary;
  document.getElementById('headerMeta').textContent =
    'Commit ' + SNAPSHOT.commit + ' · ' + new Date(SNAPSHOT.generated_at).toLocaleString();

  const attn = SNAPSHOT.files ? SNAPSHOT.files.filter(f => f.status === 'red').length : 0;
  document.getElementById('statusBar').innerHTML =
    '<span>Trajectory: <strong>' + trendArrow(s.trend) + ' ' + s.trend + '</strong></span>' +
    (attn > 0 ? '<span>Needs attention: <strong class="status-attention">' + attn + '</strong></span>' : '');

  // ── Cards ──────────────────────────────────────────────────────────────────

  const cardDefs = [
    {
      label: 'Health Score',
      value: Math.round(s.health_score * 100),
      cls: scoreColour(s.health_score),
      sub: trendArrow(s.trend) + ' ' + s.trend + ' (' + (s.trend_delta >= 0 ? '+' : '') + Math.round(s.trend_delta * 100) + 'pts)',
    },
    {
      label: 'Files',
      value: s.files_analysed,
      cls: '',
      sub: s.green_files + ' green · ' + s.amber_files + ' amber · ' + s.red_files + ' red',
    },
    {
      label: 'Total LOC',
      value: s.total_loc.toLocaleString(),
      cls: '',
      sub: '',
    },
    ...(s.coverage != null ? [{
      label: 'Coverage',
      value: Math.round(s.coverage * 100) + '%',
      cls: scoreColour(s.coverage),
      sub: '',
    }] : []),
  ];

  document.getElementById('cards').innerHTML = cardDefs.map(c =>
    '<div class="card">' +
      '<div class="card-label">' + c.label + '</div>' +
      '<div class="card-value ' + c.cls + '">' + c.value + '</div>' +
      '<div class="card-sub">' + c.sub + '</div>' +
    '</div>'
  ).join('');

  // ── Files table ────────────────────────────────────────────────────────────

  const files = (SNAPSHOT.files || []).sort((a, b) => a.health_score - b.health_score);
  document.getElementById('fileCount').textContent = '(' + files.length + ')';

  function renderSmellTags(smells, max) {
    return (smells || []).slice(0, max || 4).map(sm =>
      '<span class="smell-tag ' + sm.severity + '">' +
        sm.type.replace(/_/g, ' ') +
      '</span>'
    ).join('');
  }

  document.getElementById('filesBody').innerHTML = files.map((f, i) =>
    '<tr data-idx="' + i + '" onclick="openPanel(' + i + ')">' +
      '<td><span class="file-path">' + esc(f.path) + '</span></td>' +
      '<td><span class="score-num ' + scoreColour(f.health_score) + '">' + Math.round(f.health_score * 100) + '</span></td>' +
      '<td>' + pill(f.status) + '</td>' +
      '<td>' + f.loc + '</td>' +
      '<td>' + f.cyclomatic + '</td>' +
      '<td>' + f.churn_30d + '</td>' +
      '<td><div class="smells">' + renderSmellTags(f.smells, 3) + '</div></td>' +
    '</tr>'
  ).join('');

  // ── Detail panel ───────────────────────────────────────────────────────────

  const panel = document.getElementById('detailPanel');
  const panelHeader = document.getElementById('panelHeader');
  const panelBody = document.getElementById('panelBody');
  const main = document.getElementById('main');
  let activeIdx = -1;

  function openPanel(idx) {
    // Toggle off if clicking same row
    if (activeIdx === idx) {
      closePanel();
      return;
    }
    activeIdx = idx;

    // Update active row highlight
    document.querySelectorAll('tbody tr').forEach((r, i) => {
      r.classList.toggle('active', i === idx);
    });

    const f = files[idx];
    const assessments = getAssessments(f.path);

    renderPanelHeader(f);
    renderPanelBody(f, assessments);

    panel.classList.add('open');
    main.classList.add('panel-open');
  }

  function closePanel() {
    activeIdx = -1;
    panel.classList.remove('open');
    main.classList.remove('panel-open');
    document.querySelectorAll('tbody tr').forEach(r => r.classList.remove('active'));
  }

  function getAssessments(filePath) {
    if (!SNAPSHOT.agent_assessments) return [];
    const entry = (SNAPSHOT.agent_assessments.files || []).find(f => f.path === filePath);
    return entry ? entry.assessments : [];
  }

  // ── Panel header ──────────────────────────────────────────────────────────

  function renderPanelHeader(f) {
    const score = Math.round(f.health_score * 100);
    const circumference = 2 * Math.PI * 28;
    const offset = circumference * (1 - f.health_score);
    const arcColour = f.health_score >= 0.75 ? '#16a34a' : f.health_score >= 0.5 ? '#d97706' : '#dc2626';

    panelHeader.innerHTML =
      '<div class="score-arc-wrap" style="flex:1;min-width:0">' +
        '<div class="score-arc">' +
          '<svg width="72" height="72" viewBox="0 0 72 72">' +
            '<circle cx="36" cy="36" r="28" fill="none" stroke="#e2e8f0" stroke-width="6"/>' +
            '<circle cx="36" cy="36" r="28" fill="none" stroke="' + arcColour + '" stroke-width="6"' +
              ' stroke-dasharray="' + circumference.toFixed(1) + '"' +
              ' stroke-dashoffset="' + offset.toFixed(1) + '"' +
              ' stroke-linecap="round"/>' +
          '</svg>' +
          '<div class="score-arc-num ' + scoreColour(f.health_score) + '">' + score + '</div>' +
        '</div>' +
        '<div class="score-arc-info">' +
          '<div class="panel-file-path">' + esc(f.path) + '</div>' +
          '<div class="panel-header-meta">' +
            pill(f.status) +
            '<span>' + f.module + '</span>' +
            (f.coverage != null ? '<span>Coverage: ' + pct(f.coverage) + '</span>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<button class="panel-close" onclick="closePanel()" title="Close">✕</button>';
  }

  // ── Panel body ─────────────────────────────────────────────────────────────

  function renderPanelBody(f, assessments) {
    let html = '';

    // ── Metrics grid ───────────────────────────────────────────────────────
    html += '<div class="panel-section">';
    html += '<div class="panel-section-title">Metrics</div>';
    html += '<div class="metrics-grid">';

    const metrics = [
      { label: 'Lines of Code',  value: f.loc,                        warn: 200,  fail: 500  },
      { label: 'Cyclomatic',     value: f.cyclomatic,                  warn: 7,    fail: 12   },
      { label: 'Cognitive',      value: f.cognitive,                   warn: 10,   fail: 20   },
      { label: 'Duplication',    value: pct(f.duplication_ratio),      warnR: 0.05, failR: 0.15, raw: f.duplication_ratio },
      { label: 'Churn 30d',      value: f.churn_30d,                   warn: 10,   fail: 20   },
      { label: 'Dead Exports',   value: f.dead_exports,                warn: 3,    fail: 8    },
      { label: 'Fan-in',         value: f.coupling ? f.coupling.fan_in  : 0 },
      { label: 'Fan-out',        value: f.coupling ? f.coupling.fan_out : 0, warn: 7, fail: 12 },
    ];

    metrics.forEach(m => {
      let cls = '';
      if (m.fail != null && m.value >= m.fail) cls = 'fail';
      else if (m.warn != null && m.value >= m.warn) cls = 'warn';
      if (m.failR != null && m.raw >= m.failR) cls = 'fail';
      else if (m.warnR != null && m.raw >= m.warnR) cls = 'warn';

      html += '<div class="metric-cell">' +
        '<div class="metric-cell-label">' + m.label + '</div>' +
        '<div class="metric-cell-value ' + cls + '">' + m.value + '</div>' +
      '</div>';
    });

    html += '</div></div>';

    // ── Smells ─────────────────────────────────────────────────────────────
    if (f.smells && f.smells.length > 0) {
      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">Smells (' + f.smells.length + ')</div>';

      const sortedSmells = [...f.smells].sort((a, b) => {
        const o = { fail: 0, warn: 1, ok: 2 };
        return o[a.severity] - o[b.severity];
      });

      sortedSmells.forEach(sm => {
        const icon = sm.severity === 'fail' ? '✖' : sm.severity === 'warn' ? '⚠' : '✓';
        const colour = sm.severity === 'fail' ? 'var(--red)' : sm.severity === 'warn' ? 'var(--amber)' : 'var(--green)';
        html += '<div class="smell-row">' +
          '<span class="smell-icon" style="color:' + colour + '">' + icon + '</span>' +
          '<div>' +
            '<div>' + sm.type.replace(/_/g, ' ') + '</div>' +
            '<div class="smell-detail">' + esc(sm.detail) + '</div>' +
          '</div>' +
        '</div>';
      });

      html += '</div>';
    }

    // ── Functions ──────────────────────────────────────────────────────────
    if (f.functions && f.functions.length > 0) {
      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">Functions (' + f.functions.length + ')</div>';
      html += '<table class="fn-table">';
      html += '<thead><tr><th>Name</th><th>Lines</th><th>LOC</th><th>Cycl.</th><th>Params</th><th>Issues</th></tr></thead>';
      html += '<tbody>';

      const maxLoc = Math.max(...f.functions.map(fn => fn.loc), 1);

      f.functions.forEach(fn => {
        const locPct = Math.min((fn.loc / maxLoc) * 100, 100);
        const locCls = fn.loc >= 60 ? 'fail' : fn.loc >= 25 ? 'warn' : '';
        const cyclCls = fn.cyclomatic >= 12 ? 'c-red' : fn.cyclomatic >= 7 ? 'c-amber' : '';
        const fnSmells = fn.smells ? fn.smells.filter(s => s.severity !== 'ok') : [];

        html += '<tr>' +
          '<td><span class="fn-name">' + esc(fn.name) + '</span></td>' +
          '<td style="color:var(--text-muted);font-size:0.75rem">' + fn.line_start + '–' + fn.line_end + '</td>' +
          '<td>' +
            '<span class="fn-loc-bar-wrap"><span class="fn-loc-bar ' + locCls + '" style="width:' + locPct.toFixed(0) + '%"></span></span>' +
            ' <span style="font-size:0.75rem;' + (locCls ? 'color:var(--' + (locCls === 'fail' ? 'red' : 'amber') + ')' : '') + '">' + fn.loc + '</span>' +
          '</td>' +
          '<td class="' + cyclCls + '">' + fn.cyclomatic + '</td>' +
          '<td style="color:' + (fn.parameter_count >= 5 ? 'var(--red)' : fn.parameter_count >= 3 ? 'var(--amber)' : 'inherit') + '">' + fn.parameter_count + '</td>' +
          '<td><div class="smells">' + fnSmells.map(sm => '<span class="smell-tag ' + sm.severity + '">' + sm.type.replace(/_/g, ' ') + '</span>').join('') + '</div></td>' +
        '</tr>';
      });

      html += '</tbody></table></div>';
    }

    // ── LLM assessments ────────────────────────────────────────────────────
    if (assessments && assessments.length > 0) {
      const sortedA = [...assessments].sort((a, b) => {
        const o = { fail: 0, warn: 1, ok: 2 };
        return o[a.severity] - o[b.severity];
      });

      html += '<div class="panel-section">';
      html += '<div class="panel-section-title">LLM Assessments (' + assessments.length + ')</div>';

      sortedA.forEach(a => {
        const confPct = Math.round(a.confidence * 100);
        html += '<div class="assessment-card ' + a.severity + '">' +
          '<div class="assessment-header">' +
            '<span class="pill pill-' + a.severity + '">' + a.severity + '</span>' +
            '<span class="assessment-type">' + a.type.replace(/_/g, ' ') + '</span>' +
            '<span class="assessment-conf">confidence ' + confPct + '%</span>' +
          '</div>' +
          '<div class="assessment-detail">' + esc(a.detail) + '</div>' +
          (a.lines_of_concern && a.lines_of_concern.length ?
            '<div class="assessment-lines">Lines: ' + a.lines_of_concern.join(', ') + '</div>' : '') +
        '</div>';
      });

      html += '</div>';
    } else if (SNAPSHOT.agent_assessments) {
      html += '<div class="panel-section">' +
        '<div class="panel-section-title">LLM Assessments</div>' +
        '<div class="empty">No assessments for this file</div>' +
      '</div>';
    }

    panelBody.innerHTML = html;
  }

  // ── Keyboard close ─────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePanel();
  });
</script>
</body>
</html>`;
}
