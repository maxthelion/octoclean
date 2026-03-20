import { describe, it, expect } from 'vitest';
import { scoreFile, scoreToStatus, deltaToTrend, computeSummary } from './index.js';
import type { FileMetrics, CodeHealthConfig } from '../types/index.js';
import { DEFAULT_CONFIG } from '../config/defaults.js';

const makeFile = (overrides: Partial<FileMetrics> = {}): FileMetrics => ({
  path: 'src/test.ts',
  module: 'Application',
  health_score: 0,
  status: 'green',
  loc: 100,
  coverage: null,
  cyclomatic: 3,
  cognitive: 4,
  duplication_ratio: 0,
  churn_30d: 0,
  dead_exports: 0,
  coupling: { fan_in: 1, fan_out: 2 },
  smells: [],
  functions: [],
  ...overrides,
});

describe('scoreToStatus', () => {
  it('returns green for score >= 0.75', () => {
    expect(scoreToStatus(0.75)).toBe('green');
    expect(scoreToStatus(1.0)).toBe('green');
  });

  it('returns amber for score 0.50–0.74', () => {
    expect(scoreToStatus(0.50)).toBe('amber');
    expect(scoreToStatus(0.74)).toBe('amber');
  });

  it('returns red for score < 0.50', () => {
    expect(scoreToStatus(0.49)).toBe('red');
    expect(scoreToStatus(0)).toBe('red');
  });
});

describe('deltaToTrend', () => {
  it('returns improving for delta > 0.02', () => {
    expect(deltaToTrend(0.03)).toBe('improving');
    expect(deltaToTrend(0.10)).toBe('improving');
  });

  it('returns stable for delta within ±0.02', () => {
    expect(deltaToTrend(0.02)).toBe('stable');
    expect(deltaToTrend(-0.02)).toBe('stable');
    expect(deltaToTrend(0)).toBe('stable');
  });

  it('returns degrading for delta < -0.02', () => {
    expect(deltaToTrend(-0.03)).toBe('degrading');
    expect(deltaToTrend(-0.15)).toBe('degrading');
  });
});

describe('scoreFile', () => {
  it('gives a perfect score to a clean file', () => {
    const file = makeFile({ loc: 50, cyclomatic: 2, cognitive: 3, duplication_ratio: 0 });
    const scored = scoreFile(file, DEFAULT_CONFIG);
    expect(scored.health_score).toBe(1);
    expect(scored.status).toBe('green');
  });

  it('penalises high cyclomatic complexity', () => {
    const clean = scoreFile(makeFile({ cyclomatic: 2 }), DEFAULT_CONFIG);
    const complex = scoreFile(makeFile({ cyclomatic: 20 }), DEFAULT_CONFIG); // at fail threshold
    expect(complex.health_score).toBeLessThan(clean.health_score);
    expect(complex.health_score).toBeLessThanOrEqual(0.75);
  });

  it('penalises high LOC', () => {
    const small = scoreFile(makeFile({ loc: 50 }), DEFAULT_CONFIG);
    const large = scoreFile(makeFile({ loc: 1000 }), DEFAULT_CONFIG);
    expect(large.health_score).toBeLessThan(small.health_score);
  });

  it('penalises high duplication', () => {
    const clean = scoreFile(makeFile({ duplication_ratio: 0 }), DEFAULT_CONFIG);
    const dup = scoreFile(makeFile({ duplication_ratio: 0.25 }), DEFAULT_CONFIG);
    expect(dup.health_score).toBeLessThan(clean.health_score);
  });

  it('health score stays within [0, 1]', () => {
    const terrible = makeFile({
      loc: 5000,
      cyclomatic: 100,
      cognitive: 100,
      duplication_ratio: 1,
      churn_30d: 100,
    });
    const scored = scoreFile(terrible, DEFAULT_CONFIG);
    expect(scored.health_score).toBeGreaterThanOrEqual(0);
    expect(scored.health_score).toBeLessThanOrEqual(1);
  });

  it('penalises low coverage when coverage is enabled', () => {
    const config: CodeHealthConfig = {
      ...DEFAULT_CONFIG,
      dynamic_metrics: { ...DEFAULT_CONFIG.dynamic_metrics, coverage: true },
    };

    const highCov = scoreFile(makeFile({ coverage: 0.95 }), config);
    const lowCov = scoreFile(makeFile({ coverage: 0.10 }), config);
    expect(lowCov.health_score).toBeLessThan(highCov.health_score);
  });
});

describe('computeSummary', () => {
  it('counts files by status correctly', () => {
    const files = [
      makeFile({ health_score: 0.9, status: 'green' }),
      makeFile({ health_score: 0.6, status: 'amber' }),
      makeFile({ health_score: 0.3, status: 'red' }),
    ];

    const summary = computeSummary(files, [], undefined);
    expect(summary.green_files).toBe(1);
    expect(summary.amber_files).toBe(1);
    expect(summary.red_files).toBe(1);
    expect(summary.files_analysed).toBe(3);
  });

  it('computes trend from previous summary', () => {
    const files = [makeFile({ health_score: 0.80, status: 'green' })];
    const previous = {
      health_score: 0.70,
      trend: 'stable' as const,
      trend_delta: 0,
      coverage: null,
      total_loc: 100,
      files_analysed: 1,
      red_files: 0,
      amber_files: 1,
      green_files: 0,
    };

    const summary = computeSummary(files, [], previous);
    expect(summary.trend).toBe('improving');
    expect(summary.trend_delta).toBeCloseTo(0.10, 1);
  });
});
