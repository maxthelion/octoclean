import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './index.js';
import { DEFAULT_CONFIG } from './defaults.js';

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-test-'));
    fs.mkdirSync(path.join(tmpDir, '.codehealth'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', () => {
    const config = loadConfig(tmpDir);
    expect(config.version).toBe(1);
    expect(config.sampling).toBe('merges-to-main');
    expect(config.history_depth).toBe(50);
  });

  it('loads a valid YAML config', () => {
    const yaml = `
version: 1
sampling: weekly
history_depth: 25
main_branch: develop
static_metrics:
  - loc
  - cyclomatic
dynamic_metrics:
  coverage: false
  test_command: npm test
llm_assessments:
  enabled: false
  model_file: claude-haiku-4-5
  model_synthesis: claude-sonnet-4-6
  min_confidence_to_act: 0.8
  max_files_per_night: 20
thresholds:
  loc_warn: 200
  loc_fail: 800
  function_loc_warn: 40
  function_loc_fail: 100
  cyclomatic_warn: 8
  cyclomatic_fail: 15
  cognitive_warn: 12
  cognitive_fail: 25
  duplication_warn: 0.10
  duplication_fail: 0.20
  parameter_count_warn: 3
  parameter_count_fail: 6
  coverage_warn: 0.75
  coverage_fail: 0.50
  coupling_fan_out_warn: 8
  coupling_fan_out_fail: 15
  dead_export_warn: 3
  dead_export_fail: 10
modules:
  - path: src/
    label: Application
remediation:
  enabled: false
  branch_prefix: fix
  max_files_per_night: 5
  quarantine_after_failures: 2
  scope:
    allow:
      - rename_symbol
    deny:
      - change_interface
`;

    fs.writeFileSync(path.join(tmpDir, '.codehealth', 'config.yaml'), yaml);
    const config = loadConfig(tmpDir);

    expect(config.sampling).toBe('weekly');
    expect(config.history_depth).toBe(25);
    expect(config.main_branch).toBe('develop');
    expect(config.llm_assessments.enabled).toBe(false);
    expect(config.thresholds.loc_warn).toBe(200);
    expect(config.remediation.enabled).toBe(false);
  });

  it('throws on invalid config', () => {
    const bad = `
version: 2
sampling: invalid-strategy
`;
    fs.writeFileSync(path.join(tmpDir, '.codehealth', 'config.yaml'), bad);
    expect(() => loadConfig(tmpDir)).toThrow();
  });
});
