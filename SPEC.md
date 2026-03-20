# octoclean — Specification v2.0

## What it is

octoclean is a code quality analysis tool for JavaScript and TypeScript repositories. It scans a codebase, produces structured health metrics per file and module, and surfaces them via two outputs:

- **A visual dashboard** for human stakeholders (treemap, timeline, file detail panel)
- **A structured agent report** for autonomous fixing agents

octoclean tells you *what* is wrong and *where*. It does not attempt to fix anything itself.

---

## Design Principles

- **Measure, don't fix.** octoclean's job is analysis and reporting. Remediation is delegated to better-suited tools.
- **No external infrastructure.** The git repository is the source of truth for both code and metrics history.
- **Two audiences, one data source.** The dashboard and the agent feed consume the same snapshot JSON.
- **Incremental by default.** Nightly runs are fast because only changed files are re-processed.
- **Paired with autoresearch for fixing.** `codehealth export --autoresearch` generates a ready-to-run autoresearch session seeded from the latest snapshot. The pi autoresearch agent then uses octoclean's health score as its benchmark metric.

---

## Pairing with autoresearch

The intended fixing workflow:

```
1. codehealth scan              # measure current state
2. codehealth export --autoresearch  # generate autoresearch session files
3. pi (autoresearch loop)       # fix issues, measuring health score each iteration
4. codehealth scan              # measure final state
```

`export --autoresearch` generates three files in the target directory:

### `autoresearch.sh`
The benchmark script autoresearch runs after each experiment. Calls `codehealth scan --quick` (fast mode) and outputs METRIC lines:

```bash
#!/bin/bash
set -euo pipefail
codehealth scan --quick --output /tmp/codehealth-snapshot.json
node -e "
  const s = JSON.parse(require('fs').readFileSync('/tmp/codehealth-snapshot.json','utf8'));
  console.log('METRIC health_score=' + Math.round(s.summary.health_score * 100));
  console.log('METRIC red_files=' + s.summary.red_files);
  console.log('METRIC amber_files=' + s.summary.amber_files);
  console.log('METRIC cyclomatic_max=' + Math.max(...s.files.map(f => f.cyclomatic)));
"
```

### `autoresearch.checks.sh`
Correctness gate — runs the project test suite. autoresearch cannot keep a change that fails this:

```bash
#!/bin/bash
set -euo pipefail
# Populated from config.dynamic_metrics.test_command
npm test 2>&1 | tail -50
```

### `autoresearch.md`
The session context — seeded from the latest snapshot's agent report. Contains:

- **Objective**: improve health score from current baseline
- **Metrics**: health_score (primary, higher is better), red_files, amber_files
- **Priority queue**: top N files from `codehealth report --agent`, with issue details and permitted actions
- **Off limits**: files with high fan-in, files in excluded modules, interface changes
- **Constraints**: tests must pass, no new dependencies, no signature changes

---

## Standalone mode

Without autoresearch, octoclean works as a pure analysis tool:

```bash
codehealth init           # set up config + metrics branch
codehealth scan           # full scan + optional LLM assessments  
codehealth backfill --days 30  # populate historical timeline
codehealth serve --open   # dashboard: treemap, timeline, file detail
codehealth report --agent # structured text for any LLM agent
codehealth diff HEAD~10 HEAD  # compare two points in history
codehealth history trim   # clean up duplicate snapshots
```

---

## CLI Reference

### `codehealth init`
Initialises config, .gitignore entries, and the `codehealth-metrics` orphan branch.

### `codehealth scan [options]`
Full mechanical scan + optional LLM assessment pass.

```
--quick              Fast mode: lizard only on changed files, skip jscpd/madge
--commits N          Override history_depth for this run
--since YYYY-MM-DD   Scan commits since a specific date  
--push-metrics       Push results to codehealth-metrics branch
--no-llm             Skip LLM assessment pass
--no-dynamic         Skip coverage even if configured
--output PATH        Write JSON snapshot to a local file
```

`--quick` is optimised for repeated calls (e.g. from autoresearch). It:
- Only runs lizard (skips jscpd, madge, ts-unused-exports)
- Only processes files changed since last snapshot (git diff)
- Carries forward unchanged file metrics from the previous snapshot
- Typical runtime: <3s on a 100-file project

### `codehealth assess [options]`
LLM assessment pass only, without re-running mechanical metrics.

```
--file PATH          Assess a single file
--module NAME        Assess all files in a module
--force              Re-assess files not flagged by mechanical metrics
```

### `codehealth report [options]`
Print a summary to stdout.

```
--module NAME
--format [text|json|markdown]
--worst N            Show only N worst-scoring files
--agent              Output in agent-optimised format (structured text)
```

### `codehealth export [options]`
Export session files for use with other tools.

```
--autoresearch [DIR]   Generate autoresearch.sh, autoresearch.checks.sh,
                       and autoresearch.md in DIR (default: current directory)
```

### `codehealth serve [options]`
Serve the dashboard locally.

```
--port PORT          Default: 4321
--open               Open browser automatically
```

### `codehealth diff <from> <to>`
Compare health scores between two points in history.

### `codehealth backfill [options]`
Generate historical snapshots by scanning past commits via git worktrees.

```
--days N             One commit per day for the last N days
--since YYYY-MM-DD   All commits since a specific date
--commits N          Last N commits
--push-metrics       Push results after backfill
--dry-run            Preview without scanning
```

### `codehealth history <subcommand>`
Manage snapshot history.

```
list                 Show all snapshots
trim                 Remove duplicate scans of the same commit
remove <target>      Remove by timestamp prefix or commit hash
clear                Wipe all snapshots
```

---

## Removed

The following are removed from v2:

- `codehealth remediate` — replaced by the autoresearch integration
- `src/remediation/` directory — all code deleted
- Quarantine store (`.codehealth/quarantine.json`) — no longer needed

The autoresearch loop handles everything remediate was attempting to do, with better loop control, proven keep/discard mechanics, and the pi agent's full coding capabilities.

---

## Scan modes

### Full scan (default)
Runs all configured tools: lizard, jscpd, madge, ts-unused-exports, coverage (if enabled), git churn, versioned symbol detection. Suitable for nightly CI runs.

### Quick scan (`--quick`)
Runs lizard only on files changed since the last snapshot. Carries forward all other metrics from the previous snapshot unchanged. No jscpd, no madge, no ts-unused-exports. Suitable for autoresearch iteration loops where speed matters.

The health score from a quick scan may differ slightly from a full scan because duplication and coupling are not recomputed. This is acceptable for the autoresearch use case — the signal is directionally correct and the speed tradeoff is worth it.

---

## Health score

Unchanged from v1. A single float `[0,1]` per file, aggregated to modules.

| Signal | Weight |
|--------|--------|
| Cyclomatic complexity | 0.25 |
| Cognitive complexity | 0.20 |
| Test coverage | 0.25 |
| Lines of code | 0.10 |
| Duplication ratio | 0.10 |
| Churn × complexity | 0.10 |

Coverage weight redistributed proportionally when coverage is disabled.

Status: `≥0.75` green · `0.50–0.74` amber · `<0.50` red

---

## LLM assessments (standalone mode)

When `ANTHROPIC_API_KEY` is set and `llm_assessments.enabled: true`, each nightly scan runs a per-file assessment pass using Claude Haiku:

- **Docstring faithfulness** — does the JSDoc match the implementation?
- **Naming coherence** — does the function name reflect its responsibilities?
- **Competing implementation** — are two functions independently solving the same problem?
- **Intent clarity** — does the function appear to do what it was meant to do?

Assessments with `confidence < min_confidence_to_act` are shown on the dashboard but excluded from the agent report's priority queue.

---

## Agent report format

`codehealth report --agent` outputs structured plain text optimised for LLM consumption. This is the primary input for autoresearch's `autoresearch.md`:

```
CODEHEALTH AGENT REPORT
Generated: 2026-03-20T06:00:00Z
Commit: a1b2c3d4
Baseline health: 47

PRIORITY QUEUE (ordered by score × churn)

1. src/payments/processor.ts
   Health: 28 (red)
   Primary issue: giant function — processPayment is 420 lines
   Detail: Function spans lines 142–562. Cyclomatic complexity 34.
   Permitted actions: extract_function, update_docstring
   Off limits: fan-in 8 — do not change exports or signatures

2. src/ui/CityScreen.js
   ...

OFF LIMITS (high fan-in — do not modify exports)
  src/core/PlanarGraph.js       fan-in: 14
  src/core/FeatureMap.js        fan-in: 11

SUMMARY
  Files in queue: 12
  Estimated health after clearing queue: ~68
```
