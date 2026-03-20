import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { CONFIG_DIR, CONFIG_PATH } from '../config/index.js';
import { CONFIG_YAML_TEMPLATE } from '../config/defaults.js';
import { ensureMetricsBranch } from '../metrics/branch.js';

const WORKFLOW_PATH = '.github/workflows/octoclean.yml';

export async function runInit(cwd: string): Promise<void> {
  logger.step('Initialising octoclean…');

  // ── 1. Create .codehealth directory ───────────────────────────────────────
  fs.mkdirSync(path.join(cwd, CONFIG_DIR), { recursive: true });

  // ── 2. Write config ───────────────────────────────────────────────────────
  const configFile = path.join(cwd, CONFIG_PATH);
  if (fs.existsSync(configFile)) {
    logger.warn(`Config already exists at ${CONFIG_PATH} — skipping`);
  } else {
    fs.writeFileSync(configFile, CONFIG_YAML_TEMPLATE, 'utf8');
    logger.dim(`  Created ${CONFIG_PATH}`);
  }

  // ── 3. Update .gitignore ──────────────────────────────────────────────────
  const gitignorePath = path.join(cwd, '.gitignore');
  const gitignoreLines = ['.codehealth/local/', '.codehealth/.worktree-tmp/'];

  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    const toAdd = gitignoreLines.filter(l => !existing.includes(l));
    if (toAdd.length > 0) {
      fs.appendFileSync(gitignorePath, '\n# octoclean\n' + toAdd.join('\n') + '\n');
      logger.dim('  Updated .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, '# octoclean\n' + gitignoreLines.join('\n') + '\n');
    logger.dim('  Created .gitignore');
  }

  // ── 4. Create metrics branch ──────────────────────────────────────────────
  ensureMetricsBranch(cwd);

  // ── 5. Write GitHub Actions workflow ──────────────────────────────────────
  const workflowFile = path.join(cwd, WORKFLOW_PATH);
  if (fs.existsSync(workflowFile)) {
    logger.warn(`Workflow already exists at ${WORKFLOW_PATH} — skipping`);
  } else {
    fs.mkdirSync(path.dirname(workflowFile), { recursive: true });
    fs.writeFileSync(workflowFile, buildWorkflow(cwd), 'utf8');
    logger.dim(`  Created ${WORKFLOW_PATH}`);
  }

  logger.success('octoclean initialised!');
  console.log('');
  console.log('  Next steps:');
  console.log(`  1. Edit ${CONFIG_PATH} — set main_branch to your branch name`);
  console.log('  2. codehealth scan');
  console.log('  3. codehealth serve --open');
  console.log('');
  console.log('  To publish a live dashboard on GitHub Pages:');
  console.log('  4. codehealth pages --enable');
  console.log(`  5. Commit and push ${WORKFLOW_PATH}`);
  console.log('     → Dashboard rebuilds automatically on every push to main');
  console.log('');
}

// ─── Workflow template ────────────────────────────────────────────────────────

function buildWorkflow(cwd: string): string {
  // Try to detect the main branch name from git
  let mainBranch = 'main';
  try {
    const { execSync } = require('node:child_process');
    const detected = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf8' }).trim();
    if (detected && detected !== 'HEAD') mainBranch = detected;
  } catch { /* use default */ }

  return `name: octoclean

on:
  push:
    branches: [${mainBranch}]
  schedule:
    - cron: '0 2 * * *'   # nightly at 2am UTC
  workflow_dispatch:       # allow manual runs from GitHub UI

jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: write      # required to push to codehealth-metrics branch

    steps:
      - name: Checkout (full history)
        uses: actions/checkout@v4
        with:
          fetch-depth: 0   # full history needed for churn metrics

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Set up Python (for lizard)
        uses: actions/setup-python@v5
        with:
          python-version: '3.x'

      - name: Install lizard
        run: pip install lizard

      - name: Install octoclean and analysis tools
        run: npm install -g octoclean jscpd madge ts-unused-exports

      - name: Configure git identity
        run: |
          git config user.name  "octoclean"
          git config user.email "octoclean@users.noreply.github.com"

      - name: Scan, build dashboard, push
        run: codehealth scan --no-llm --push-metrics --pages
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
`;
}
