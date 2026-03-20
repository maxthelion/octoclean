import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { detectVersionedSymbols } from './versioned-symbols.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('detectVersionedSymbols', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-vs-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects _v2 suffix', () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), `
      function parseDate(s) {}
      function parseDate_v2(s) {}
    `);
    const results = detectVersionedSymbols(['test.ts'], tmpDir, 'abc123');
    expect(results.some(r => r.name === 'parseDate_v2')).toBe(true);
  });

  it('detects _legacy suffix', () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), `
      const processPayment_legacy = () => {};
    `);
    const results = detectVersionedSymbols(['test.ts'], tmpDir, 'abc123');
    expect(results.some(r => r.name === 'processPayment_legacy')).toBe(true);
  });

  it('does not detect symbols in comments', () => {
    fs.writeFileSync(path.join(tmpDir, 'test.ts'), `
      // processPayment_old was removed
      function processPayment(x) {}
    `);
    const results = detectVersionedSymbols(['test.ts'], tmpDir, 'abc123');
    expect(results.some(r => r.name === 'processPayment_old')).toBe(false);
  });

  it('returns empty for files without versioned symbols', () => {
    fs.writeFileSync(path.join(tmpDir, 'clean.ts'), `
      function processPayment(x) {}
      const validate = (x) => {};
    `);
    const results = detectVersionedSymbols(['clean.ts'], tmpDir, 'abc123');
    expect(results).toHaveLength(0);
  });
});
