# CodeHealth

> Code quality analysis across git history — dashboard for humans, structured feed for agents.

## Quick Start

```bash
# Install
npm install --save-dev codehealth

# Initialise in your repo
npx codehealth init

# Run a full scan
npx codehealth scan

# View the dashboard
npx codehealth serve --open

# Generate an agent report
npx codehealth report --agent
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `codehealth init` | Initialise config, metrics branch, .gitignore |
| `codehealth scan` | Run mechanical scan + LLM assessments |
| `codehealth assess` | LLM assessment pass only (no re-scan) |
| `codehealth report` | Print summary (`--format text\|json\|markdown`, `--agent`) |
| `codehealth remediate` | Run the automated fix agent loop |
| `codehealth serve` | Serve the dashboard locally |
| `codehealth diff <from> <to>` | Compare health between two points in history |

## Configuration

Config lives at `.codehealth/config.yaml` (checked into git). Run `codehealth init` to generate it with all defaults.

Key settings:

```yaml
sampling: merges-to-main    # merges-to-main | weekly | every-commit
history_depth: 50           # commits to scan on first run
llm_assessments:
  enabled: true
  min_confidence_to_act: 0.75
thresholds:
  cyclomatic_fail: 20
  coverage_fail: 0.40
```

## How Metrics Are Collected

| Signal | Tool | Notes |
|--------|------|-------|
| Complexity + LOC | `lizard` (Python) | `pip install lizard` |
| Duplication | `jscpd` | `npm i -D jscpd` |
| Coupling | `madge` | `npm i -D madge` |
| Dead exports | `ts-unused-exports` | `npm i -D ts-unused-exports` |
| Coverage | `c8` / `nyc` | opt-in via config |
| Churn | `git log` | built-in |

## Health Score

Each file gets a `[0, 1]` score weighted as:

| Signal | Weight |
|--------|--------|
| Cyclomatic complexity | 25% |
| Cognitive complexity | 20% |
| Test coverage | 25% |
| Lines of code | 10% |
| Duplication | 10% |
| Churn × complexity | 10% |

`≥ 0.75` → green · `0.50–0.74` → amber · `< 0.50` → red

## LLM Assessments

Requires `ANTHROPIC_API_KEY`. Uses Claude Haiku for per-file passes and Claude Sonnet for module summaries.

Assessment types:
- **Docstring faithfulness** — does the JSDoc match the implementation?
- **Naming coherence** — does the function name reflect what it actually does?
- **Competing implementation** — are two functions independently solving the same problem?
- **Intent clarity** — does the function appear to do what it was meant to do?

## Remediation Agent

```bash
codehealth remediate --dry-run   # preview
codehealth remediate             # run
```

The agent prioritises files by `(1 - health_score) × churn × confidence`, generates fixes on `codehealth/fix/*` branches, runs your test suite, and leaves passing branches for your review. Files that fail `quarantine_after_failures` times are excluded for 7 days.

## State Storage

Metrics are stored on an orphan git branch `codehealth-metrics` — no external infrastructure required. Push it to your remote with `--push-metrics` to share with your team.

## Requirements

- Node.js ≥ 18
- Git (full history: `git fetch --unshallow`)
- `lizard` Python package for complexity metrics
- `jscpd`, `madge`, `ts-unused-exports` as dev dependencies (optional but recommended)

## Development

```bash
npm install
npm run typecheck    # type-check only
npm test             # run tests
npm run build        # compile to dist/
```
