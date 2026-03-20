import type { CodeHealthConfig } from '../types/index.js';

export const DEFAULT_CONFIG: CodeHealthConfig = {
  version: 1,
  sampling: 'merges-to-main',
  history_depth: 50,
  main_branch: 'main',
  static_metrics: [
    'loc',
    'cyclomatic',
    'cognitive',
    'duplication',
    'dead_exports',
    'churn',
    'coupling',
    'versioned_symbols',
  ],
  dynamic_metrics: {
    coverage: false,
    test_command: 'npx nyc npm test',
  },
  llm_assessments: {
    enabled: true,
    model_file: 'claude-haiku-4-5',
    model_synthesis: 'claude-sonnet-4-6',
    min_confidence_to_act: 0.75,
    max_files_per_night: 40,
  },
  thresholds: {
    loc_warn: 300,
    loc_fail: 1000,
    function_loc_warn: 40,
    function_loc_fail: 100,
    cyclomatic_warn: 10,
    cyclomatic_fail: 20,
    cognitive_warn: 15,
    cognitive_fail: 30,
    duplication_warn: 0.10,
    duplication_fail: 0.25,
    parameter_count_warn: 4,
    parameter_count_fail: 7,
    coverage_warn: 0.70,
    coverage_fail: 0.40,
    coupling_fan_out_warn: 10,
    coupling_fan_out_fail: 20,
    dead_export_warn: 5,
    dead_export_fail: 15,
  },
  modules: [
    { path: 'src/', label: 'Application' },
    { path: 'tests/', label: 'Tests', exclude_from_scoring: true },
  ],
  remediation: {
    enabled: true,
    branch_prefix: 'codehealth/fix',
    max_files_per_night: 10,
    quarantine_after_failures: 3,
    scope: {
      allow: [
        'rename_symbol',
        'extract_function',
        'consolidate_duplicate',
        'update_docstring',
        'remove_dead_export',
      ],
      deny: [
        'change_interface',
        'modify_exports',
        'alter_data_structure',
      ],
    },
  },
};

export const CONFIG_YAML_TEMPLATE = `# .codehealth/config.yaml
version: 1

# Commit sampling strategy.
# Options: merges-to-main | weekly | every-commit
sampling: merges-to-main

# Number of historical commits to scan on first run.
# Subsequent runs are incremental.
history_depth: 50

# Main branch name.
main_branch: main

# Static metrics — always collected, no test runner required.
static_metrics:
  - loc
  - cyclomatic
  - cognitive
  - duplication
  - dead_exports
  - churn
  - coupling
  - versioned_symbols

# Dynamic metrics — require running the test suite.
dynamic_metrics:
  coverage: false
  test_command: npx nyc npm test

# LLM assessments — nightly pass over changed and flagged files.
llm_assessments:
  enabled: true
  model_file: claude-haiku-4-5
  model_synthesis: claude-sonnet-4-6
  min_confidence_to_act: 0.75
  max_files_per_night: 40

# Thresholds. warn = amber, fail = red.
thresholds:
  loc_warn: 300
  loc_fail: 1000
  function_loc_warn: 40
  function_loc_fail: 100
  cyclomatic_warn: 10
  cyclomatic_fail: 20
  cognitive_warn: 15
  cognitive_fail: 30
  duplication_warn: 0.10
  duplication_fail: 0.25
  parameter_count_warn: 4
  parameter_count_fail: 7
  coverage_warn: 0.70
  coverage_fail: 0.40
  coupling_fan_out_warn: 10
  coupling_fan_out_fail: 20
  dead_export_warn: 5
  dead_export_fail: 15

# Module definitions.
modules:
  - path: src/
    label: Application
  - path: tests/
    label: Tests
    exclude_from_scoring: true

# Remediation agent settings.
remediation:
  enabled: true
  branch_prefix: codehealth/fix
  max_files_per_night: 10
  quarantine_after_failures: 3
  scope:
    allow:
      - rename_symbol
      - extract_function
      - consolidate_duplicate
      - update_docstring
      - remove_dead_export
    deny:
      - change_interface
      - modify_exports
      - alter_data_structure
`;
