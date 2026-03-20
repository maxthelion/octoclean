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
      --surface: #fff;
      --border: #e2e8f0;
      --border-light: #f1f5f9;
      --text: #0f172a;
      --text-muted: #64748b;
      --text-faint: #94a3b8;
      --green: #16a34a;  --green-bg: #dcfce7;
      --amber: #d97706;  --amber-bg: #fef9c3;
      --red:   #dc2626;  --red-bg:   #fee2e2;
      --blue:  #2563eb;
      --panel-width: 560px;
      --header-h: 52px;
    }

    body { font-family: system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:var(--bg); color:var(--text); font-size:14px; line-height:1.5; }

    /* ── Header ── */
    header { position:sticky; top:0; z-index:10; height:var(--header-h); background:#0f172a; color:#f8fafc; display:flex; align-items:center; padding:0 20px; gap:16px; box-shadow:0 1px 3px rgba(0,0,0,.3); }
    header h1 { font-size:.9375rem; font-weight:600; white-space:nowrap; }
    .header-meta { font-size:.75rem; color:#94a3b8; }
    .status-bar { margin-left:auto; display:flex; gap:20px; font-size:.8125rem; align-items:center; }
    .status-bar span { color:#94a3b8; }
    .status-bar strong { color:#f8fafc; }
    .status-attention { color:#f87171 !important; font-weight:700; }

    /* ── Layout ── */
    .layout { display:flex; min-height:calc(100vh - var(--header-h)); }
    main { flex:1; min-width:0; padding:20px; transition:margin-right .25s ease; }
    main.panel-open { margin-right:var(--panel-width); }

    /* ── Cards ── */
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:16px; }
    .card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px 18px; }
    .card-label { font-size:.6875rem; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted); }
    .card-value { font-size:2rem; font-weight:700; margin-top:2px; line-height:1.1; }
    .card-sub   { font-size:.75rem; color:var(--text-muted); margin-top:3px; }

    /* ── Tabs ── */
    .tabs { display:flex; gap:2px; margin-bottom:16px; background:var(--border); border-radius:8px; padding:3px; width:fit-content; }
    .tab { background:none; border:none; cursor:pointer; padding:6px 14px; border-radius:6px; font-size:.8125rem; font-weight:500; color:var(--text-muted); transition:all .15s; }
    .tab:hover { color:var(--text); }
    .tab.active { background:var(--surface); color:var(--text); box-shadow:0 1px 3px rgba(0,0,0,.1); }
    .tab-content { display:none; }
    .tab-content.visible { display:block; }

    /* ── Treemap ── */
    .treemap-wrap { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; position:relative; }
    #treemap-svg { display:block; width:100%; cursor:pointer; }
    .treemap-node { transition:opacity .1s; }
    .treemap-node:hover { opacity:.85; }
    .treemap-label { pointer-events:none; dominant-baseline:middle; }

    /* Tooltip */
    .tooltip {
      position:fixed; z-index:100; background:#0f172a; color:#f8fafc; border-radius:8px;
      padding:10px 13px; font-size:.8125rem; max-width:280px; pointer-events:none;
      opacity:0; transition:opacity .1s; line-height:1.5;
      box-shadow:0 4px 20px rgba(0,0,0,.3);
    }
    .tooltip.visible { opacity:1; }
    .tt-path  { font-family:monospace; font-size:.75rem; color:#94a3b8; margin-bottom:5px; word-break:break-all; }
    .tt-score { font-size:1.5rem; font-weight:700; }
    .tt-meta  { color:#94a3b8; font-size:.75rem; margin-top:3px; }
    .tt-smells { margin-top:6px; border-top:1px solid #1e293b; padding-top:6px; font-size:.75rem; color:#cbd5e1; }

    /* ── Timeline ── */
    .timeline-wrap { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:20px; }
    .timeline-wrap h2 { font-size:.875rem; font-weight:600; margin-bottom:16px; }
    #timeline-canvas { display:block; width:100%; }
    .timeline-legend { display:flex; flex-wrap:wrap; gap:12px; margin-top:12px; font-size:.75rem; }
    .legend-item { display:flex; align-items:center; gap:5px; }
    .legend-dot { width:10px; height:10px; border-radius:50%; }
    .timeline-loading { color:var(--text-muted); font-size:.875rem; padding:40px 0; text-align:center; }

    /* ── Files table ── */
    .table-wrap { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
    .table-header { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--border); }
    .table-header h2 { font-size:.875rem; font-weight:600; }
    .table-header-meta { font-size:.75rem; color:var(--text-muted); }
    table { width:100%; border-collapse:collapse; }
    th { background:#f8fafc; font-size:.6875rem; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); text-align:left; padding:9px 14px; border-bottom:1px solid var(--border); white-space:nowrap; }
    td { padding:9px 14px; border-bottom:1px solid var(--border-light); vertical-align:middle; }
    tr:last-child td { border-bottom:none; }
    tbody tr { cursor:pointer; transition:background .1s; }
    tbody tr:hover { background:#f8fafc; }
    tbody tr.active { background:#eff6ff; }
    .file-path { font-family:'SF Mono','Fira Code',monospace; font-size:.8125rem; }
    .score-num { font-weight:700; font-size:.9375rem; }

    /* ── Pills / tags ── */
    .pill { display:inline-flex; align-items:center; padding:2px 7px; border-radius:9999px; font-size:.6875rem; font-weight:600; text-transform:uppercase; }
    .pill-green { background:var(--green-bg); color:#15803d; }
    .pill-amber { background:var(--amber-bg); color:#a16207; }
    .pill-red   { background:var(--red-bg);   color:#b91c1c; }
    .smells { display:flex; flex-wrap:wrap; gap:4px; }
    .smell-tag { font-size:.625rem; padding:1px 6px; border-radius:4px; background:#f1f5f9; color:#475569; white-space:nowrap; }
    .smell-tag.fail { background:var(--red-bg); color:#b91c1c; }
    .smell-tag.warn { background:var(--amber-bg); color:#a16207; }

    /* ── Detail panel ── */
    .detail-panel { position:fixed; top:var(--header-h); right:0; width:var(--panel-width); height:calc(100vh - var(--header-h)); background:var(--surface); border-left:1px solid var(--border); overflow-y:auto; transform:translateX(100%); transition:transform .25s ease; z-index:20; display:flex; flex-direction:column; }
    .detail-panel.open { transform:translateX(0); }
    .panel-header { position:sticky; top:0; background:var(--surface); border-bottom:1px solid var(--border); padding:14px 18px; display:flex; align-items:flex-start; gap:10px; z-index:1; }
    .panel-header-content { flex:1; min-width:0; }
    .panel-file-path { font-family:'SF Mono','Fira Code',monospace; font-size:.8125rem; word-break:break-all; line-height:1.4; }
    .panel-header-meta { font-size:.75rem; color:var(--text-muted); margin-top:4px; display:flex; gap:10px; flex-wrap:wrap; }
    .panel-close { background:none; border:none; cursor:pointer; color:var(--text-muted); font-size:1.25rem; line-height:1; padding:2px 4px; border-radius:4px; flex-shrink:0; }
    .panel-close:hover { background:var(--border-light); color:var(--text); }
    .panel-body { padding:16px 18px; flex:1; }
    .panel-section { margin-bottom:20px; }
    .panel-section-title { font-size:.6875rem; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted); margin-bottom:10px; font-weight:600; }
    .metrics-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .metric-cell { background:var(--bg); border:1px solid var(--border); border-radius:7px; padding:9px 12px; }
    .metric-cell-label { font-size:.6875rem; color:var(--text-muted); }
    .metric-cell-value { font-size:1.125rem; font-weight:700; margin-top:1px; }
    .metric-cell-value.warn { color:var(--amber); }
    .metric-cell-value.fail { color:var(--red); }
    .smell-row { display:flex; align-items:flex-start; gap:8px; padding:8px 0; border-bottom:1px solid var(--border-light); font-size:.8125rem; }
    .smell-row:last-child { border-bottom:none; }
    .smell-detail { color:var(--text-muted); font-size:.75rem; }
    .fn-table { width:100%; border-collapse:collapse; font-size:.8125rem; }
    .fn-table th { font-size:.625rem; background:none; padding:5px 8px; border-bottom:1px solid var(--border); color:var(--text-muted); }
    .fn-table td { padding:6px 8px; border-bottom:1px solid var(--border-light); }
    .fn-table tr:last-child td { border-bottom:none; }
    .fn-name { font-family:'SF Mono','Fira Code',monospace; font-size:.75rem; }
    .fn-loc-bar-wrap { width:60px; height:6px; background:var(--border); border-radius:3px; overflow:hidden; display:inline-block; vertical-align:middle; }
    .fn-loc-bar { height:100%; border-radius:3px; background:var(--blue); }
    .fn-loc-bar.warn { background:var(--amber); }
    .fn-loc-bar.fail { background:var(--red); }
    .assessment-card { border:1px solid var(--border); border-radius:8px; padding:12px 14px; margin-bottom:8px; }
    .assessment-card.fail { border-color:#fca5a5; background:#fff8f8; }
    .assessment-card.warn { border-color:#fde68a; background:#fffdf0; }
    .assessment-card.ok   { border-color:#bbf7d0; background:#f0fff4; }
    .assessment-header { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
    .assessment-type { font-size:.75rem; font-weight:600; text-transform:capitalize; }
    .assessment-conf { font-size:.6875rem; color:var(--text-muted); margin-left:auto; }
    .assessment-detail { font-size:.8125rem; color:var(--text-muted); line-height:1.5; }
    .assessment-lines { font-size:.6875rem; color:var(--blue); margin-top:5px; font-family:monospace; }
    .score-arc-wrap { display:flex; align-items:center; gap:14px; margin-bottom:14px; }
    .score-arc { position:relative; width:72px; height:72px; flex-shrink:0; }
    .score-arc svg { transform:rotate(-90deg); }
    .score-arc-num { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:1.25rem; font-weight:700; }
    .empty { padding:32px 0; text-align:center; color:var(--text-muted); font-size:.875rem; }
    .c-green { color:var(--green); } .c-amber { color:var(--amber); } .c-red { color:var(--red); }
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

    <div class="tabs" id="tabs">
      <button class="tab active" data-tab="treemap">Treemap</button>
      <button class="tab"        data-tab="files">Files</button>
      <button class="tab"        data-tab="timeline">Timeline</button>
    </div>

    <!-- Treemap -->
    <div id="tab-treemap" class="tab-content visible">
      <div class="treemap-wrap">
        <svg id="treemap-svg"></svg>
      </div>
    </div>

    <!-- Files -->
    <div id="tab-files" class="tab-content">
      <div class="table-wrap">
        <div class="table-header">
          <h2>Files <span id="fileCount" style="color:var(--text-muted);font-weight:400"></span></h2>
          <span class="table-header-meta">Sorted by health score · click a row to inspect</span>
        </div>
        <table>
          <thead><tr>
            <th>File</th><th>Health</th><th>Status</th><th>LOC</th><th>Cyclomatic</th><th>Churn 30d</th><th>Issues</th>
          </tr></thead>
          <tbody id="filesBody"></tbody>
        </table>
      </div>
    </div>

    <!-- Timeline -->
    <div id="tab-timeline" class="tab-content">
      <div class="timeline-wrap">
        <h2>Health Score Over Time</h2>
        <div id="timeline-loading" class="timeline-loading">Loading history…</div>
        <canvas id="timeline-canvas" height="320" style="display:none"></canvas>
        <div class="timeline-legend" id="timeline-legend"></div>
      </div>
    </div>
  </main>

  <aside class="detail-panel" id="detailPanel">
    <div id="panelHeader"></div>
    <div class="panel-body" id="panelBody"></div>
  </aside>
</div>

<!-- Tooltip -->
<div class="tooltip" id="tooltip"></div>

<script>
const SNAPSHOT = ${data};

// ── Colour helpers ────────────────────────────────────────────────────────────

function lerpRGB(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function healthColour(score) {
  const RED   = [220, 38,  38];
  const AMBER = [217, 119,  6];
  const GREEN = [ 22, 163, 74];
  let rgb;
  if      (score < 0.5)  rgb = lerpRGB(RED,   AMBER, score / 0.5);
  else if (score < 0.75) rgb = lerpRGB(AMBER,  GREEN, (score - 0.5) / 0.25);
  else                   rgb = GREEN;
  return \`rgb(\${rgb[0]},\${rgb[1]},\${rgb[2]})\`;
}

function scoreColourClass(s) { return s >= 0.75 ? 'c-green' : s >= 0.5 ? 'c-amber' : 'c-red'; }
function pill(s) { return '<span class="pill pill-' + s + '">' + s + '</span>'; }
function trendArrow(t) { return t==='improving'?'↑':t==='degrading'?'↓':'→'; }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function pct(n) { return n != null ? Math.round(n * 100) + '%' : '—'; }

// ── Header ────────────────────────────────────────────────────────────────────

const s = SNAPSHOT.summary;
document.getElementById('headerMeta').textContent =
  'Commit ' + SNAPSHOT.commit + ' · ' + new Date(SNAPSHOT.generated_at).toLocaleString();

const attn = (SNAPSHOT.files || []).filter(f => f.status === 'red').length;
document.getElementById('statusBar').innerHTML =
  '<span>Trajectory: <strong>' + trendArrow(s.trend) + ' ' + s.trend + '</strong></span>' +
  (attn > 0 ? '<span>Needs attention: <strong class="status-attention">' + attn + '</strong></span>' : '');

// ── Summary cards ─────────────────────────────────────────────────────────────

document.getElementById('cards').innerHTML = [
  { label:'Health Score', value: Math.round(s.health_score*100), cls: scoreColourClass(s.health_score),
    sub: trendArrow(s.trend)+' '+s.trend+' ('+(s.trend_delta>=0?'+':'')+Math.round(s.trend_delta*100)+'pts)' },
  { label:'Files', value: s.files_analysed, cls:'',
    sub: s.green_files+' green · '+s.amber_files+' amber · '+s.red_files+' red' },
  { label:'Total LOC', value: s.total_loc.toLocaleString(), cls:'', sub:'' },
  ...(s.coverage != null ? [{ label:'Coverage', value: pct(s.coverage), cls: scoreColourClass(s.coverage), sub:'' }] : []),
].map(c =>
  '<div class="card"><div class="card-label">'+c.label+'</div>' +
  '<div class="card-value '+c.cls+'">'+c.value+'</div>' +
  '<div class="card-sub">'+c.sub+'</div></div>'
).join('');

// ── Tab switching ─────────────────────────────────────────────────────────────

document.getElementById('tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  const tabName = btn.dataset.tab;

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('visible'));
  btn.classList.add('active');
  document.getElementById('tab-' + tabName).classList.add('visible');

  if (tabName === 'treemap') renderTreemap();
  if (tabName === 'timeline') loadTimeline();
});

// ═════════════════════════════════════════════════════════════════════════════
// TREEMAP
// ═════════════════════════════════════════════════════════════════════════════

const files = (SNAPSHOT.files || []).sort((a, b) => a.health_score - b.health_score);
let treemapRendered = false;

function renderTreemap() {
  if (treemapRendered) return;
  treemapRendered = true;

  const svg = document.getElementById('treemap-svg');
  const wrap = svg.parentElement;
  const W = wrap.clientWidth;
  const H = Math.max(480, Math.round(W * 0.55));
  svg.setAttribute('viewBox', '0 0 '+W+' '+H);
  svg.setAttribute('height', H);

  // Build input nodes — value = LOC (min 10 so tiny files still appear)
  const nodes = files.map((f, i) => ({ f, i, value: Math.max(f.loc || 10, 10) }));

  const rects = squarify(nodes, 0, 0, W, H);
  const PAD = 1.5;

  rects.forEach(r => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.classList.add('treemap-node');
    g.dataset.idx = r.i;

    // Background rect
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', r.x + PAD);
    rect.setAttribute('y', r.y + PAD);
    rect.setAttribute('width',  Math.max(r.w - PAD*2, 0));
    rect.setAttribute('height', Math.max(r.h - PAD*2, 0));
    rect.setAttribute('rx', 3);
    rect.setAttribute('fill', healthColour(r.f.health_score));
    g.appendChild(rect);

    // Label (only if rect is big enough)
    const rw = r.w - PAD*2;
    const rh = r.h - PAD*2;
    if (rw > 50 && rh > 22) {
      const maxChars = Math.floor(rw / 7);
      const parts = r.f.path.split('/');
      let label = parts[parts.length - 1] || r.f.path;
      if (label.length > maxChars) label = label.slice(0, maxChars - 1) + '…';

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', r.x + PAD + rw / 2);
      text.setAttribute('y', r.y + PAD + rh / 2);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', 'rgba(255,255,255,0.9)');
      text.setAttribute('font-size', Math.min(12, rh * 0.35));
      text.setAttribute('font-family', 'system-ui,sans-serif');
      text.classList.add('treemap-label');
      text.textContent = label;
      g.appendChild(text);

      // Score badge for larger rects
      if (rh > 44 && rw > 70) {
        const score = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        score.setAttribute('x', r.x + PAD + rw / 2);
        score.setAttribute('y', r.y + PAD + rh / 2 + 14);
        score.setAttribute('text-anchor', 'middle');
        score.setAttribute('dominant-baseline', 'middle');
        score.setAttribute('fill', 'rgba(255,255,255,0.65)');
        score.setAttribute('font-size', 10);
        score.setAttribute('font-family', 'system-ui,sans-serif');
        score.classList.add('treemap-label');
        score.textContent = Math.round(r.f.health_score * 100);
        g.appendChild(score);
      }
    }

    g.addEventListener('mouseenter', e => showTooltip(e, r.f));
    g.addEventListener('mousemove',  e => moveTooltip(e));
    g.addEventListener('mouseleave', hideTooltip);
    g.addEventListener('click', () => openPanel(r.i));

    svg.appendChild(g);
  });

  // Re-render if container width changed (e.g. panel opened)
  const observer = new ResizeObserver(() => {
    if (wrap.clientWidth !== W) { treemapRendered = false; svg.innerHTML = ''; renderTreemap(); }
  });
  observer.observe(wrap);
}

// ── Squarified treemap algorithm ──────────────────────────────────────────────

function squarify(nodes, x, y, w, h) {
  if (!nodes.length || w <= 0 || h <= 0) return [];
  const total = nodes.reduce((s, n) => s + n.value, 0);
  const scaled = nodes.map(n => ({...n, _v: n.value * (w * h) / total}));
  return _layout(scaled, x, y, w, h);
}

function _layout(items, x, y, w, h) {
  if (!items.length) return [];
  if (items.length === 1) return [{...items[0], x, y, w, h}];

  const isHoriz = w >= h;
  const side    = isHoriz ? w : h;

  // Greedy row selection: keep adding items while worst aspect ratio improves
  let row = [], rowSum = 0, prevWorst = Infinity, cutAt = items.length;

  for (let i = 0; i < items.length; i++) {
    const candidate = [...row, items[i]];
    const candidateSum = rowSum + items[i]._v;
    const worst = _worstRatio(candidate, candidateSum, side);

    if (row.length > 0 && worst > prevWorst) { cutAt = i; break; }

    row = candidate;
    rowSum = candidateSum;
    prevWorst = worst;
  }

  // Place row
  const rowRects = _placeRow(row, rowSum, x, y, w, h, isHoriz, side);

  // Recurse on remainder
  const thickness = rowSum / side;
  const [rx, ry, rw, rh] = isHoriz
    ? [x, y + thickness, w, h - thickness]
    : [x + thickness, y, w - thickness, h];

  return [...rowRects, ..._layout(items.slice(cutAt), rx, ry, rw, rh)];
}

function _worstRatio(row, rowSum, side) {
  const thickness = rowSum / side;
  let worst = 0;
  for (const item of row) {
    const len = item._v / thickness;
    worst = Math.max(worst, Math.max(thickness / len, len / thickness));
  }
  return worst;
}

function _placeRow(row, rowSum, x, y, w, h, isHoriz, side) {
  const thickness = rowSum / side;
  const results = [];
  let pos = 0;
  for (const item of row) {
    const len = item._v / thickness;
    results.push(isHoriz
      ? {...item, x: x + pos, y,           w: len,       h: thickness}
      : {...item, x,           y: y + pos,  w: thickness, h: len}
    );
    pos += len;
  }
  return results;
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

const tooltip = document.getElementById('tooltip');

function showTooltip(e, f) {
  const topSmells = (f.smells || [])
    .filter(s => s.severity !== 'ok')
    .sort((a, b) => (a.severity==='fail'?0:1) - (b.severity==='fail'?0:1))
    .slice(0, 3);

  tooltip.innerHTML =
    '<div class="tt-path">' + esc(f.path) + '</div>' +
    '<div class="tt-score" style="color:'+healthColour(f.health_score)+'">' +
      Math.round(f.health_score*100) +
      ' <span style="font-size:.875rem;font-weight:400;color:#94a3b8">' + f.status + '</span>' +
    '</div>' +
    '<div class="tt-meta">'+f.loc+' LOC · CCN '+f.cyclomatic+' · churn '+f.churn_30d+'d</div>' +
    (topSmells.length ? '<div class="tt-smells">' + topSmells.map(s =>
      (s.severity==='fail'?'✖ ':'⚠ ') + s.detail
    ).join('<br>') + '</div>' : '');

  moveTooltip(e);
  tooltip.classList.add('visible');
}

function moveTooltip(e) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const tw = 280, pad = 16;
  let left = e.clientX + 14;
  let top  = e.clientY - 10;
  if (left + tw + pad > vw) left = e.clientX - tw - 14;
  if (top + 150 > vh)       top  = vh - 160;
  tooltip.style.left = left + 'px';
  tooltip.style.top  = top  + 'px';
}

function hideTooltip() { tooltip.classList.remove('visible'); }

// Defer treemap render to ensure browser has completed layout and clientWidth is non-zero
requestAnimationFrame(() => requestAnimationFrame(renderTreemap));

// ═════════════════════════════════════════════════════════════════════════════
// FILES TABLE
// ═════════════════════════════════════════════════════════════════════════════

document.getElementById('fileCount').textContent = '(' + files.length + ')';

document.getElementById('filesBody').innerHTML = files.map((f, i) => {
  const smellsHtml = (f.smells || []).slice(0,3).map(sm =>
    '<span class="smell-tag '+sm.severity+'">' + sm.type.replace(/_/g,' ') + '</span>'
  ).join('');
  return '<tr data-idx="'+i+'" onclick="openPanel('+i+')">' +
    '<td><span class="file-path">'+esc(f.path)+'</span></td>' +
    '<td><span class="score-num '+scoreColourClass(f.health_score)+'">'+Math.round(f.health_score*100)+'</span></td>' +
    '<td>'+pill(f.status)+'</td>' +
    '<td>'+f.loc+'</td>' +
    '<td>'+f.cyclomatic+'</td>' +
    '<td>'+f.churn_30d+'</td>' +
    '<td><div class="smells">'+smellsHtml+'</div></td>' +
    '</tr>';
}).join('');

// ═════════════════════════════════════════════════════════════════════════════
// TIMELINE
// ═════════════════════════════════════════════════════════════════════════════

let timelineLoaded = false;

async function loadTimeline() {
  if (timelineLoaded) return;
  timelineLoaded = true;

  const loading = document.getElementById('timeline-loading');
  const canvas  = document.getElementById('timeline-canvas');

  try {
    // Try static URL first (GitHub Pages: index.json at repo root),
    // then fall back to local dev API server
    let index = null;
    for (const url of ['./index.json', '/api/index']) {
      try {
        const r = await fetch(url);
        if (r.ok) { index = await r.json(); break; }
      } catch { /* try next */ }
    }
    if (!index) throw new Error('no index available');

    if (!index.snapshots || index.snapshots.length < 2) {
      loading.textContent = 'Not enough history yet — run more scans to see trends.';
      return;
    }

    // Sort by timestamp ascending, then deduplicate — keep only the latest
    // snapshot per commit hash (removes duplicate scans of the same state)
    const byCommit = new Map();
    for (const s of index.snapshots) {
      const existing = byCommit.get(s.commit);
      if (!existing || new Date(s.timestamp) > new Date(existing.timestamp)) {
        byCommit.set(s.commit, s);
      }
    }

    const points = [...byCommit.values()]
      .map(s => ({ date: new Date(s.timestamp), score: s.summary.health_score, commit: s.commit }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    loading.style.display = 'none';
    canvas.style.display  = 'block';
    drawTimeline(canvas, points, index.snapshots);

  } catch (e) {
    loading.textContent = 'No history data found. Run codehealth serve locally, or push metrics to see the timeline on GitHub Pages.';
  }
}

function drawTimeline(canvas, points, snapshots) {
  const wrap  = canvas.parentElement;
  const W     = wrap.clientWidth - 40; // account for padding
  const H     = 320;
  const PAD   = { top: 20, right: 20, bottom: 40, left: 48 };
  const PLOT_W = W - PAD.left - PAD.right;
  const PLOT_H = H - PAD.top  - PAD.bottom;

  canvas.width  = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  const minDate = points[0].date.getTime();
  const maxDate = points[points.length-1].date.getTime();
  const dateRange = maxDate - minDate || 1;

  function toX(date) { return PAD.left + ((date.getTime() - minDate) / dateRange) * PLOT_W; }
  function toY(score) { return PAD.top + (1 - score) * PLOT_H; }

  // ── Grid lines ──────────────────────────────────────────────────────────
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth   = 1;
  [0, 0.25, 0.5, 0.75, 1.0].forEach(score => {
    const y = toY(score);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + PLOT_W, y); ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font      = '11px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(score*100), PAD.left - 6, y + 4);
  });

  // Threshold lines
  [[0.75, '#16a34a', 'green'], [0.5, '#d97706', 'amber']].forEach(([score, colour, label]) => {
    const y = toY(score);
    ctx.strokeStyle = colour + '40';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + PLOT_W, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colour;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(label, PAD.left + PLOT_W + 4, y + 4);
  });

  // ── Overall health line ──────────────────────────────────────────────────
  const lineColour = '#2563eb';
  ctx.strokeStyle = lineColour;
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = toX(p.date), y = toY(p.score);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // ── Dots with regression markers ─────────────────────────────────────────
  points.forEach((p, i) => {
    const x = toX(p.date), y = toY(p.score);
    const prev = points[i - 1];
    const isRegression = prev && (prev.score - p.score) > 0.05;

    ctx.beginPath();
    ctx.arc(x, y, isRegression ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle   = isRegression ? '#dc2626' : lineColour;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5;
    ctx.fill();
    ctx.stroke();

    // Regression label
    if (isRegression) {
      ctx.fillStyle = '#dc2626';
      ctx.font      = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('↓', x, y - 10);
    }
  });

  // ── X-axis date labels ───────────────────────────────────────────────────
  const maxLabels = Math.min(points.length, Math.floor(PLOT_W / 80));
  const step = Math.max(1, Math.floor(points.length / maxLabels));
  ctx.fillStyle = '#94a3b8';
  ctx.font      = '11px system-ui';
  ctx.textAlign = 'center';
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    const x = toX(p.date);
    ctx.fillText(p.date.toLocaleDateString(undefined, { month:'short', day:'numeric' }), x, H - PAD.bottom + 20);
  });

  // ── Legend ───────────────────────────────────────────────────────────────
  document.getElementById('timeline-legend').innerHTML =
    '<div class="legend-item"><span class="legend-dot" style="background:#2563eb"></span>Overall health</div>' +
    '<div class="legend-item"><span class="legend-dot" style="background:#dc2626"></span>Regression (>5pt drop)</div>';
}

// ═════════════════════════════════════════════════════════════════════════════
// DETAIL PANEL
// ═════════════════════════════════════════════════════════════════════════════

const panel      = document.getElementById('detailPanel');
const panelHeader = document.getElementById('panelHeader');
const panelBody  = document.getElementById('panelBody');
const mainEl     = document.getElementById('main');
let activeIdx    = -1;

function openPanel(idx) {
  if (activeIdx === idx) { closePanel(); return; }
  activeIdx = idx;

  document.querySelectorAll('tbody tr').forEach((r, i) => r.classList.toggle('active', i === idx));
  document.querySelectorAll('.treemap-node').forEach(n =>
    n.style.opacity = (parseInt(n.dataset.idx) === idx) ? '1' : '0.7'
  );

  const f = files[idx];
  const assessments = getAssessments(f.path);
  renderPanelHeader(f);
  renderPanelBody(f, assessments);

  panel.classList.add('open');
  mainEl.classList.add('panel-open');
  treemapRendered = false; // force re-render at new width
}

function closePanel() {
  activeIdx = -1;
  panel.classList.remove('open');
  mainEl.classList.remove('panel-open');
  document.querySelectorAll('tbody tr').forEach(r => r.classList.remove('active'));
  document.querySelectorAll('.treemap-node').forEach(n => n.style.opacity = '');
  treemapRendered = false;
}

function getAssessments(filePath) {
  const entry = (SNAPSHOT.agent_assessments?.files || []).find(f => f.path === filePath);
  return entry ? entry.assessments : [];
}

function renderPanelHeader(f) {
  const score = Math.round(f.health_score * 100);
  const circ  = 2 * Math.PI * 28;
  const offset = circ * (1 - f.health_score);
  const arcColour = f.health_score >= 0.75 ? '#16a34a' : f.health_score >= 0.5 ? '#d97706' : '#dc2626';

  panelHeader.innerHTML =
    '<div class="score-arc-wrap" style="flex:1;min-width:0">' +
      '<div class="score-arc">' +
        '<svg width="72" height="72" viewBox="0 0 72 72">' +
          '<circle cx="36" cy="36" r="28" fill="none" stroke="#e2e8f0" stroke-width="6"/>' +
          '<circle cx="36" cy="36" r="28" fill="none" stroke="'+arcColour+'" stroke-width="6"' +
            ' stroke-dasharray="'+circ.toFixed(1)+'" stroke-dashoffset="'+offset.toFixed(1)+'"' +
            ' stroke-linecap="round"/>' +
        '</svg>' +
        '<div class="score-arc-num ' + scoreColourClass(f.health_score) + '">'+score+'</div>' +
      '</div>' +
      '<div class="score-arc-info">' +
        '<div class="panel-file-path">'+esc(f.path)+'</div>' +
        '<div class="panel-header-meta">' + pill(f.status) +
          '<span>'+f.module+'</span>' +
          (f.coverage != null ? '<span>Coverage: '+pct(f.coverage)+'</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    '<button class="panel-close" onclick="closePanel()" title="Close">✕</button>';
}

function renderPanelBody(f, assessments) {
  let html = '';

  // Metrics grid
  html += '<div class="panel-section"><div class="panel-section-title">Metrics</div>';
  html += '<div class="metrics-grid">';
  [
    { label:'Lines of Code', value:f.loc,                    warn:200,  fail:500  },
    { label:'Cyclomatic',    value:f.cyclomatic,              warn:7,    fail:12   },
    { label:'Cognitive',     value:f.cognitive,               warn:10,   fail:20   },
    { label:'Duplication',   value:pct(f.duplication_ratio),  warnR:0.05, failR:0.15, raw:f.duplication_ratio },
    { label:'Churn 30d',     value:f.churn_30d,               warn:10,   fail:20   },
    { label:'Dead Exports',  value:f.dead_exports,            warn:3,    fail:8    },
    { label:'Fan-in',        value:f.coupling?.fan_in  ?? 0  },
    { label:'Fan-out',       value:f.coupling?.fan_out ?? 0, warn:7,    fail:12   },
  ].forEach(m => {
    let cls = '';
    if (m.fail  != null && m.value  >= m.fail)  cls = 'fail';
    else if (m.warn != null && m.value  >= m.warn)  cls = 'warn';
    if (m.failR != null && m.raw   >= m.failR) cls = 'fail';
    else if (m.warnR != null && m.raw >= m.warnR) cls = 'warn';
    html += '<div class="metric-cell"><div class="metric-cell-label">'+m.label+'</div>' +
            '<div class="metric-cell-value '+cls+'">'+m.value+'</div></div>';
  });
  html += '</div></div>';

  // Smells
  if (f.smells?.length) {
    const sorted = [...f.smells].sort((a,b) => ({fail:0,warn:1,ok:2}[a.severity])-({fail:0,warn:1,ok:2}[b.severity]));
    html += '<div class="panel-section"><div class="panel-section-title">Smells ('+f.smells.length+')</div>';
    sorted.forEach(sm => {
      const icon   = sm.severity==='fail'?'✖':sm.severity==='warn'?'⚠':'✓';
      const colour = sm.severity==='fail'?'var(--red)':sm.severity==='warn'?'var(--amber)':'var(--green)';
      html += '<div class="smell-row"><span style="color:'+colour+';flex-shrink:0">'+icon+'</span>' +
              '<div><div>'+sm.type.replace(/_/g,' ')+'</div><div class="smell-detail">'+esc(sm.detail)+'</div></div></div>';
    });
    html += '</div>';
  }

  // Functions
  if (f.functions?.length) {
    const maxLoc = Math.max(...f.functions.map(fn => fn.loc), 1);
    html += '<div class="panel-section"><div class="panel-section-title">Functions ('+f.functions.length+')</div>';
    html += '<table class="fn-table"><thead><tr><th>Name</th><th>Lines</th><th>LOC</th><th>Cycl.</th><th>Params</th><th>Issues</th></tr></thead><tbody>';
    f.functions.forEach(fn => {
      const locPct = Math.min((fn.loc / maxLoc) * 100, 100);
      const locCls  = fn.loc >= 60 ? 'fail' : fn.loc >= 25 ? 'warn' : '';
      const cyclCls = fn.cyclomatic >= 12 ? 'c-red' : fn.cyclomatic >= 7 ? 'c-amber' : '';
      const fnSmells = (fn.smells || []).filter(s => s.severity !== 'ok');
      html += '<tr>' +
        '<td><span class="fn-name">'+esc(fn.name)+'</span></td>' +
        '<td style="color:var(--text-muted);font-size:.75rem">'+fn.line_start+'–'+fn.line_end+'</td>' +
        '<td><span class="fn-loc-bar-wrap"><span class="fn-loc-bar '+locCls+'" style="width:'+locPct.toFixed(0)+'%"></span></span>' +
          ' <span style="font-size:.75rem'+(locCls?';color:var(--'+(locCls==='fail'?'red':'amber')+')':'')+'">'+fn.loc+'</span></td>' +
        '<td class="'+cyclCls+'">'+fn.cyclomatic+'</td>' +
        '<td style="color:'+(fn.parameter_count>=5?'var(--red)':fn.parameter_count>=3?'var(--amber)':'inherit')+'">'+fn.parameter_count+'</td>' +
        '<td><div class="smells">'+fnSmells.map(s=>'<span class="smell-tag '+s.severity+'">'+s.type.replace(/_/g,' ')+'</span>').join('')+'</div></td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
  }

  // LLM assessments
  if (assessments?.length) {
    const sorted = [...assessments].sort((a,b) => ({fail:0,warn:1,ok:2}[a.severity])-({fail:0,warn:1,ok:2}[b.severity]));
    html += '<div class="panel-section"><div class="panel-section-title">LLM Assessments ('+assessments.length+')</div>';
    sorted.forEach(a => {
      html += '<div class="assessment-card '+a.severity+'">' +
        '<div class="assessment-header">' +
          '<span class="pill pill-'+a.severity+'">'+a.severity+'</span>' +
          '<span class="assessment-type">'+a.type.replace(/_/g,' ')+'</span>' +
          '<span class="assessment-conf">confidence '+Math.round(a.confidence*100)+'%</span>' +
        '</div>' +
        '<div class="assessment-detail">'+esc(a.detail)+'</div>' +
        (a.lines_of_concern?.length ? '<div class="assessment-lines">Lines: '+a.lines_of_concern.join(', ')+'</div>' : '') +
        '</div>';
    });
    html += '</div>';
  }

  panelBody.innerHTML = html;
}

// Keyboard close
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
</script>
</body>
</html>`;
}
