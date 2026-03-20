import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { CONFIG_DIR, CONFIG_PATH } from '../config/index.js';
import { CONFIG_YAML_TEMPLATE } from '../config/defaults.js';
import { ensureMetricsBranch } from '../metrics/branch.js';

export async function runInit(cwd: string): Promise<void> {
  logger.step('Initialising CodeHealth…');

  // ── 1. Create .codehealth directory ───────────────────────────────────────
  const configDir = path.join(cwd, CONFIG_DIR);
  fs.mkdirSync(configDir, { recursive: true });
  logger.dim(`  Created ${CONFIG_DIR}/`);

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
  const gitignoreLines = [
    '.codehealth/local/',
    '.codehealth/quarantine.json',
    '.codehealth/.worktree-tmp/',
  ];

  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, 'utf8');
    const toAdd = gitignoreLines.filter(line => !existing.includes(line));

    if (toAdd.length > 0) {
      fs.appendFileSync(gitignorePath, '\n# CodeHealth\n' + toAdd.join('\n') + '\n');
      logger.dim('  Updated .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, '# CodeHealth\n' + gitignoreLines.join('\n') + '\n');
    logger.dim('  Created .gitignore');
  }

  // ── 4. Create metrics branch ──────────────────────────────────────────────
  ensureMetricsBranch(cwd);

  logger.success('CodeHealth initialised!');
  console.log('');
  console.log('  Next steps:');
  console.log(`  1. Review ${CONFIG_PATH} and configure your modules`);
  console.log('  2. Run: codehealth scan');
  console.log('  3. View: codehealth serve --open');
  console.log('');
}
