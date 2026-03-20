/**
 * Local dashboard server — serves the static SPA from the metrics branch
 * or a pre-built local copy.
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../utils/logger.js';
import { readFromMetricsBranch, METRICS_DIR } from '../metrics/branch.js';
import { loadLatestSnapshot, loadIndex } from '../metrics/index.js';
import type { ServeOptions } from '../types/index.js';

export async function serveDashboard(options: ServeOptions, cwd: string): Promise<void> {
  const app = express();

  // ── API endpoints consumed by the dashboard SPA ──────────────────────────

  // Latest snapshot
  app.get('/api/snapshot/latest', (_req, res) => {
    const snapshot = loadLatestSnapshot(cwd);
    if (!snapshot) {
      res.status(404).json({ error: 'No snapshots found. Run codehealth scan first.' });
      return;
    }
    res.json(snapshot);
  });

  // Index (list of all snapshots)
  app.get('/api/index', (_req, res) => {
    const index = loadIndex(cwd);
    if (!index) {
      res.status(404).json({ error: 'No index found.' });
      return;
    }
    res.json(index);
  });

  // Specific snapshot by timestamp
  app.get('/api/snapshot/:timestamp', (req, res) => {
    const snapshotPath = `${METRICS_DIR}/${req.params.timestamp}.json`;
    const raw = readFromMetricsBranch(snapshotPath, cwd);
    if (!raw) {
      res.status(404).json({ error: 'Snapshot not found' });
      return;
    }
    res.json(JSON.parse(raw));
  });

  // ── Serve the SPA ─────────────────────────────────────────────────────────
  const dashboardDir = path.join(cwd, '.codehealth', 'dashboard');
  const builtInDashboard = new URL('../dashboard/static', import.meta.url).pathname;

  const staticDir = fs.existsSync(dashboardDir) ? dashboardDir : builtInDashboard;

  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));

    // SPA fallback
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  } else {
    // Fallback: serve a minimal inline dashboard if no static files exist
    app.get('/', (_req, res) => {
      res.send(buildFallbackHtml());
    });
  }

  // ── Start server ──────────────────────────────────────────────────────────
  const server = app.listen(options.port, () => {
    const url = `http://localhost:${options.port}`;
    logger.success(`Dashboard running at ${url}`);

    if (options.open) {
      import('open').then(({ default: open }) => {
        open(url).catch(() => {});
      });
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
}

// ─── Fallback HTML (shown when no built dashboard exists) ─────────────────────

function buildFallbackHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeHealth</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 60px auto; padding: 0 24px; color: #1a1a1a; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #666; margin-bottom: 32px; }
    .card { border: 1px solid #e5e5e5; border-radius: 8px; padding: 24px; margin-bottom: 16px; }
    .score { font-size: 3rem; font-weight: 700; }
    .green { color: #16a34a; }
    .amber { color: #d97706; }
    .red { color: #dc2626; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e5e5e5; font-size: 0.875rem; }
    th { background: #f9fafb; font-weight: 600; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .pill-green { background: #dcfce7; color: #15803d; }
    .pill-amber { background: #fef9c3; color: #a16207; }
    .pill-red { background: #fee2e2; color: #b91c1c; }
  </style>
</head>
<body>
  <h1>CodeHealth</h1>
  <p class="subtitle">Loading snapshot…</p>
  <div id="root"></div>
  <script>
    async function load() {
      const res = await fetch('/api/snapshot/latest');
      if (!res.ok) {
        document.querySelector('.subtitle').textContent = 'No snapshot found. Run: codehealth scan';
        return;
      }
      const data = await res.json();
      render(data);
    }

    function statusClass(s) {
      return s === 'green' ? 'green' : s === 'amber' ? 'amber' : 'red';
    }

    function render(snap) {
      const s = snap.summary;
      document.querySelector('.subtitle').textContent =
        snap.repo + ' · ' + new Date(snap.generated_at).toLocaleString();

      document.getElementById('root').innerHTML = \`
        <div class="card">
          <div class="score \${statusClass(s.health_score >= 0.75 ? 'green' : s.health_score >= 0.5 ? 'amber' : 'red')}">
            \${Math.round(s.health_score * 100)}
          </div>
          <div>Overall health · \${s.trend} \${s.trend_delta >= 0 ? '+' : ''}\${(s.trend_delta * 100).toFixed(0)}pts</div>
          <div style="margin-top:8px;font-size:0.875rem;color:#666">
            \${s.green_files} green · \${s.amber_files} amber · \${s.red_files} red
          </div>
        </div>

        <h2 style="font-size:1rem;font-weight:600;margin-bottom:8px">Files (worst first)</h2>
        <table>
          <thead><tr><th>File</th><th>Health</th><th>Status</th><th>LOC</th><th>Churn</th></tr></thead>
          <tbody>
            \${snap.files
              .sort((a, b) => a.health_score - b.health_score)
              .slice(0, 25)
              .map(f => \`
                <tr>
                  <td>\${f.path}</td>
                  <td>\${Math.round(f.health_score * 100)}</td>
                  <td><span class="pill pill-\${f.status}">\${f.status}</span></td>
                  <td>\${f.loc}</td>
                  <td>\${f.churn_30d}</td>
                </tr>
              \`).join('')}
          </tbody>
        </table>
      \`;
    }

    load();
  </script>
</body>
</html>`;
}
