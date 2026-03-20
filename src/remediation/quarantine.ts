/**
 * Quarantine store — tracks files that have failed remediation repeatedly.
 * After quarantine_after_failures attempts, a file is excluded for 7 days.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { QuarantineStore, QuarantineEntry, RemediationAction } from '../types/index.js';

const QUARANTINE_FILE = '.codehealth/quarantine.json';
const QUARANTINE_DAYS = 7;

// ─── Load / save ──────────────────────────────────────────────────────────────

export function loadQuarantine(cwd: string): QuarantineStore {
  const filePath = path.join(cwd, QUARANTINE_FILE);
  if (!fs.existsSync(filePath)) return { entries: {} };

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as QuarantineStore;
  } catch {
    return { entries: {} };
  }
}

export function saveQuarantine(store: QuarantineStore, cwd: string): void {
  const filePath = path.join(cwd, QUARANTINE_FILE);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
}

// ─── State checks ─────────────────────────────────────────────────────────────

export function isQuarantined(filePath: string, store: QuarantineStore): boolean {
  const entry = store.entries[filePath];
  if (!entry) return false;

  return new Date(entry.quarantined_until) > new Date();
}

export function getQuarantineEntry(filePath: string, store: QuarantineStore): QuarantineEntry | null {
  return store.entries[filePath] ?? null;
}

// ─── Record failure ───────────────────────────────────────────────────────────

export function recordFailure(
  filePath: string,
  action: RemediationAction,
  reason: string,
  maxFailures: number,
  store: QuarantineStore
): QuarantineStore {
  const existing = store.entries[filePath];
  const failures = (existing?.failures ?? 0) + 1;
  const now = new Date().toISOString();

  const quarantinedUntil = failures >= maxFailures
    ? new Date(Date.now() + QUARANTINE_DAYS * 24 * 60 * 60 * 1000).toISOString()
    : existing?.quarantined_until ?? now;

  return {
    ...store,
    entries: {
      ...store.entries,
      [filePath]: {
        path: filePath,
        failures,
        last_attempt: now,
        last_action: action,
        reason,
        quarantined_until: quarantinedUntil,
      },
    },
  };
}

// ─── Release ──────────────────────────────────────────────────────────────────

export function releaseFromQuarantine(filePath: string, store: QuarantineStore): QuarantineStore {
  const { [filePath]: _removed, ...rest } = store.entries;
  return { entries: rest };
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function getActiveQuarantineEntries(store: QuarantineStore): QuarantineEntry[] {
  const now = new Date();
  return Object.values(store.entries).filter(
    e => new Date(e.quarantined_until) > now
  );
}
