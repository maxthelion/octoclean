# octoclean

> Code quality analysis for JavaScript and TypeScript repositories. Scans your codebase, tracks health over time, and surfaces issues for humans and agents.

octoclean tells you **what is wrong and where**. It does not try to fix anything itself — for that, it pairs with [pi autoresearch](https://github.com/davebcn87/pi-autoresearch), which uses octoclean's health score as its benchmark metric and agent report as its priority queue.

---

## Install globally

```bash
npm install -g github:maxthelion/octoclean
```

Then install the analysis tools octoclean depends on:

```bash
pip install lizard                              # complexity + LOC
npm install -g jscpd madge ts-unused-exports   # duplication, coupling, dead exports
```

---

## Quick start

```bash
cd your-project

codehealth init          # creates .codehealth/config.yaml, sets up metrics branch
codehealth scan          # run a full scan
codehealth serve --open  # open the dashboard
```

To populate the timeline with history:

```bash
codehealth backfill --days 30   # one commit per day for the last 30 days
```

---

## Dashboard

`codehealth serve --open` launches a local dashboard with three views:

**Treemap** — every file as a rectangle. Area = lines of code. Colour = health score (red → amber → green). Click any file to see a detail panel with metrics breakdown, smells, function-level data, and LLM assessments.

**Timeline** — health score over time. Regression markers (red dot) on commits where the score dropped more than 5 points.

**Files** — sortable table of all files, worst first.

---

## CLI reference

| Command | Description |
|---------|-------------|
| `codehealth init` | Initialise config, .gitignore, metrics branch, GitHub Actions workflow |
| `codehealth scan` | Full mechanical scan + optional LLM assessments |
| `codehealth scan --quick` | Fast scan: lizard only on changed files, for use in autoresearch loops |
| `codehealth report` | Print summary to stdout |
| `codehealth report --agent` | Structured text output for LLM agents |
| `codehealth export --autoresearch` | Generate autoresearch session files (see below) |
| `codehealth serve` | Serve the dashboard locally |
| `codehealth pages` | Build static dashboard for GitHub Pages |
| `codehealth pages --enable` | One-time: push metrics branch + enable GitHub Pages via `gh` |
| `codehealth backfill --days N` | Populate historical timeline |
| `codehealth diff <from> <to>` | Compare health between two points |
| `codehealth history list` | Show all snapshots |
| `codehealth history trim` | Remove duplicate snapshots |
| `codehealth history clear` | Wipe all snapshots |

---

## Health score

Each file gets a score from 0 to 100, weighted across:

| Signal | Weight | Tool |
|--------|--------|------|
| Cyclomatic complexity | 25% | lizard |
| Cognitive complexity | 20% | lizard |
| Test coverage | 25% | c8 / nyc (opt-in) |
| Lines of code | 10% | lizard |
| Duplication | 10% | jscpd |
| Churn × complexity | 10% | git log |

**≥ 75** → green · **50–74** → amber · **< 50** → red

Default thresholds are deliberately strict. Adjust them in `.codehealth/config.yaml`.

---

## LLM assessments

With `ANTHROPIC_API_KEY` set, each scan runs a per-file assessment pass using Claude Haiku:

- **Docstring faithfulness** — does the JSDoc match the implementation?
- **Naming coherence** — does the function name reflect its actual responsibilities?
- **Competing implementation** — are two functions independently solving the same problem?
- **Intent clarity** — does this function appear to do what it was meant to do?

Assessments appear as badges in the dashboard file detail panel and are included in the agent report.

---

## Pairing with autoresearch

octoclean identifies what needs fixing. [pi autoresearch](https://github.com/davebcn87/pi-autoresearch) fixes it, using octoclean's health score as the benchmark metric.

### Setup

1. Install pi and the autoresearch skill — follow the instructions in the [pi autoresearch repo](https://github.com/davebcn87/pi-autoresearch).

2. Run a scan to get a baseline:

```bash
codehealth scan
```

3. Generate the autoresearch session files:

```bash
codehealth export --autoresearch
```

This creates three files in the current directory:

- **`autoresearch.sh`** — the benchmark script. Runs `codehealth scan --quick` and outputs `METRIC health_score=N` and secondary metrics. autoresearch calls this after every experiment.
- **`autoresearch.checks.sh`** — runs your test suite. autoresearch cannot keep a change that fails this.
- **`autoresearch.md`** — the session context, seeded from `codehealth report --agent`. Contains the priority queue (which files, what issues, what actions are permitted), off-limits files, and constraints.

4. Start the autoresearch loop:

```bash
pi   # then ask it to run autoresearch
```

The pi agent reads `autoresearch.md`, attempts code improvements, and calls `autoresearch.sh` after each change. If health score improves and tests pass, the change is kept. Otherwise it's discarded and the agent tries something else.

### What autoresearch can do

Everything the agent report marks as a permitted action:

- Extract a repeated or overly complex block into a named helper
- Consolidate two functions that independently implement the same logic
- Update a JSDoc comment to match the current implementation
- Split a giant function at a natural boundary
- Rename a symbol to better reflect its responsibilities
- Remove a dead export

### What it won't touch

octoclean marks high-fan-in files (many importers) as off-limits in `autoresearch.md`. Changing the interface of a widely-imported file risks cascading breakage. The test suite (`autoresearch.checks.sh`) is the final safety net regardless.

---

## Configuration

Config lives at `.codehealth/config.yaml`, checked into git. `codehealth init` creates it with defaults.

```yaml
version: 1
main_branch: main          # set to your actual branch name (v5, master, etc.)
history_depth: 50

thresholds:
  loc_warn: 200
  loc_fail: 500
  cyclomatic_warn: 7
  cyclomatic_fail: 12
  cognitive_warn: 10
  cognitive_fail: 20
  duplication_warn: 0.05
  duplication_fail: 0.15
  parameter_count_warn: 3
  parameter_count_fail: 5
  coverage_warn: 0.80
  coverage_fail: 0.60

modules:
  - path: src/
    label: Application
  - path: tests/
    label: Tests
    exclude_from_scoring: true

llm_assessments:
  enabled: true
  model_file: claude-haiku-4-5
  model_synthesis: claude-sonnet-4-6
  min_confidence_to_act: 0.75
  max_files_per_night: 40

dynamic_metrics:
  coverage: false
  test_command: npx nyc npm test
```

**Important:** set `main_branch` to the branch your project actually develops on. octoclean uses this for backfill commit sampling and churn calculation.

---

## GitHub Pages

octoclean can publish a live, auto-updating dashboard to GitHub Pages. You can see octoclean scanning itself at **[maxthelion.github.io/octoclean](https://maxthelion.github.io/octoclean/)**.

### Setup (three commands)

```bash
codehealth init          # creates config + .github/workflows/octoclean.yml
codehealth scan          # initial scan
codehealth pages --enable  # pushes metrics branch + enables Pages via gh CLI
```

Then commit and push the workflow:

```bash
git add .github .codehealth
git push
```

From that point on, every push to your main branch triggers the GitHub Action which scans, rebuilds `index.html`, and pushes it to the `codehealth-metrics` branch. GitHub Pages serves the updated dashboard automatically.

The workflow file created by `codehealth init` (`.github/workflows/octoclean.yml`) also runs nightly at 2am UTC, so the timeline stays current even on quiet days.

### Requirements

- `gh` CLI installed and authenticated (`gh auth login`) for `--enable`
- The repo must be public, or have GitHub Pages enabled on the plan

### Manual setup (without gh CLI)

If you prefer not to use `gh`:

1. Run `codehealth pages --push` to build and push `index.html`
2. Go to repo **Settings → Pages**
3. Set source to **Deploy from a branch**, branch `codehealth-metrics`, folder `/ (root)`

---

## State storage

Metrics are stored on an orphan git branch `codehealth-metrics` — no external infrastructure required. Share it with your team by pushing to a remote:

```bash
codehealth scan --push-metrics
```

Or push after a backfill:

```bash
codehealth backfill --days 30 --push-metrics
```

---

## Requirements

- Node.js ≥ 18
- Git with full history (`git fetch --unshallow` in CI)
- `lizard` — `pip install lizard`
- `jscpd`, `madge`, `ts-unused-exports` — optional but recommended for full signal coverage

---

## Development

```bash
git clone https://github.com/maxthelion/octoclean
cd octoclean
npm install
npm run build
npm install -g .    # install locally for testing
npm test
```
