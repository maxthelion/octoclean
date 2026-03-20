import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { CodeHealthConfig } from '../types/index.js';
import { DEFAULT_CONFIG } from './defaults.js';

// ─── Config file location ─────────────────────────────────────────────────────

export const CONFIG_DIR = '.codehealth';
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.yaml');

// ─── Zod schema (validates user config, fills defaults) ───────────────────────

const ThresholdSchema = z.object({
  loc_warn: z.number().default(200),
  loc_fail: z.number().default(500),
  function_loc_warn: z.number().default(25),
  function_loc_fail: z.number().default(60),
  cyclomatic_warn: z.number().default(7),
  cyclomatic_fail: z.number().default(12),
  cognitive_warn: z.number().default(10),
  cognitive_fail: z.number().default(20),
  duplication_warn: z.number().default(0.05),
  duplication_fail: z.number().default(0.15),
  parameter_count_warn: z.number().default(3),
  parameter_count_fail: z.number().default(5),
  coverage_warn: z.number().default(0.80),
  coverage_fail: z.number().default(0.60),
  coupling_fan_out_warn: z.number().default(7),
  coupling_fan_out_fail: z.number().default(12),
  dead_export_warn: z.number().default(3),
  dead_export_fail: z.number().default(8),
});

const ModuleConfigSchema = z.object({
  path: z.string(),
  label: z.string(),
  exclude_from_scoring: z.boolean().default(false),
});

const ConfigSchema = z.object({
  version: z.literal(1),
  sampling: z.enum(['merges-to-main', 'weekly', 'every-commit']).default('merges-to-main'),
  history_depth: z.number().int().positive().default(50),
  main_branch: z.string().default('main'),
  static_metrics: z.array(
    z.enum(['loc', 'cyclomatic', 'cognitive', 'duplication', 'dead_exports', 'churn', 'coupling', 'versioned_symbols'])
  ).default(DEFAULT_CONFIG.static_metrics),
  dynamic_metrics: z.object({
    coverage: z.boolean().default(false),
    test_command: z.string().default('npx nyc npm test'),
  }).default(DEFAULT_CONFIG.dynamic_metrics),
  llm_assessments: z.object({
    enabled: z.boolean().default(true),
    model_file: z.string().default('claude-haiku-4-5'),
    model_synthesis: z.string().default('claude-sonnet-4-6'),
    min_confidence_to_act: z.number().min(0).max(1).default(0.75),
    max_files_per_night: z.number().int().positive().default(40),
  }).default(DEFAULT_CONFIG.llm_assessments),
  thresholds: ThresholdSchema.default(DEFAULT_CONFIG.thresholds),
  modules: z.array(ModuleConfigSchema).default(DEFAULT_CONFIG.modules),
  remediation: z.object({
    enabled: z.boolean().default(true),
    branch_prefix: z.string().default('codehealth/fix'),
    max_files_per_night: z.number().int().positive().default(10),
    quarantine_after_failures: z.number().int().positive().default(3),
    scope: z.object({
      allow: z.array(z.string()).default(DEFAULT_CONFIG.remediation.scope.allow),
      deny: z.array(z.string()).default(DEFAULT_CONFIG.remediation.scope.deny),
    }).default(DEFAULT_CONFIG.remediation.scope),
  }).default(DEFAULT_CONFIG.remediation),
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load and validate config from the nearest .codehealth/config.yaml.
 * Walks up from cwd if not found in current directory.
 * Falls back to defaults if no config file exists.
 */
export function loadConfig(cwd: string = process.cwd()): CodeHealthConfig {
  const configPath = findConfigFile(cwd);

  if (!configPath) {
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = yaml.load(raw);

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid config at ${configPath}:\n${issues}`);
  }

  return result.data as CodeHealthConfig;
}

/**
 * Walk up directories looking for .codehealth/config.yaml
 */
function findConfigFile(startDir: string): string | null {
  let current = startDir;

  while (true) {
    const candidate = path.join(current, CONFIG_PATH);
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(current);
    if (parent === current) return null; // reached filesystem root
    current = parent;
  }
}

/**
 * Find the project root (directory containing .codehealth/config.yaml or .git)
 */
export function findProjectRoot(cwd: string = process.cwd()): string {
  let current = cwd;

  while (true) {
    if (
      fs.existsSync(path.join(current, CONFIG_PATH)) ||
      fs.existsSync(path.join(current, '.git'))
    ) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) return cwd; // fallback to cwd
    current = parent;
  }
}

export { DEFAULT_CONFIG };
