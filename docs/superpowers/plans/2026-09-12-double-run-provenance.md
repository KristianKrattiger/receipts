# Double-Run Provenance (Phase 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `assay(..., { runs: 2 })` stamps each admitted row `stable` or `provisional`; Tesla's 3a `--replay` stays identical; no paid re-sample on this branch.

**Architecture:** Pure `mergeRuns` in `src/assay/merge.ts`. `assay` loops samples when `runs: 2`. The CLI supplies `withProposalCache(..., { sample })` per sample and stamps `replay.samples`. `cacheOnlyClient` takes `sample`. Renderers print class and a provenance footer only when rows carry `provenance`.

**Tech Stack:** TypeScript ESM, vitest, tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-12-double-run-provenance-design.md`.

## Global Constraints

- Node ESM `.js` specifiers. `npm run typecheck` clean after every task.
- No new runtime dependencies.
- `src/assay/` stays disk-agnostic. Cache remains a client.
- Nothing under `reports/`, `snapshots/`, `cache/`, `fixtures/`, `plans/` changes. Tesla `--replay` stays identical. `npm run replay` stays `1 replayed, 3 not replayable`.
- `runs: 1` adds no `row.provenance`. That is the Tesla-replay contract.
- Tests hermetic: no network, no model, temp cwd.
- Prose must not outrun code. Do not claim Tesla has been double-sampled.
- `npm test` and `npm run typecheck` before every commit.

## File map

| File | Responsibility |
|---|---|
| `src/assay/merge.ts` (new) | `rowKey`, `passIdOf`, `mergeRuns` |
| `src/assay/merge.test.ts` (new) | class rules, pass-scope, runDisagreement, determinism |
| `src/assay/index.ts` | `runs`, `clientForSample`, loop |
| `src/assay/types.ts` | `AssayOptions.runs`, `Audit.runDisagreement` |
| `src/types.ts` | `LedgerRow.provenance?`, `ReplayManifest.samples?`, `runs?` |
| `src/provenance/proposal-cache.ts` | `cacheOnlyClient({ sample })` |
| `src/cli/args.ts` | `--runs` |
| `src/cli/index.ts` | two clients; stamp; default 2 |
| `src/cli/replay.ts` | runs from stamp; per-sample cache-only client |
| `src/pipeline.ts` | plumb `runs` / `clientForSample` |
| `src/report/render/{terminal,html,markdown}.ts` | class mark + footer |
| `README.md` | honest 3b limit |

---

### Task 1: mergeRuns

**Files:** Create `src/assay/merge.ts`, `src/assay/merge.test.ts`

**Interfaces:** as in the spec (`rowKey`, `passIdOf`, `mergeRuns`).

- [ ] Tests: both→stable; one→single-proposer-run; volatile downgrade; stabilityViolated; pass-failed not single-proposer-run; ledger vs BELOW_THRESHOLD → runDisagreement all provisional; two merges strictly equal.
- [ ] Implement.
- [ ] `npx vitest run src/assay/merge.test.ts` PASS.
- [ ] Commit `feat(assay): merge two proposer samples into stable/provisional rows`

### Task 2: cacheOnlyClient takes sample

**Files:** Modify `src/provenance/proposal-cache.ts`, `src/provenance/proposal-cache.test.ts`

- [ ] Test: sample 1 misses a sample-0 file; sample 0 still hits.
- [ ] `cacheOnlyClient({ sample?: number })`, default 0.
- [ ] Commit `feat(provenance): cache-only client keys the sample`

### Task 3: assay loops

**Files:** Modify `src/assay/index.ts`, `src/assay/types.ts`, `src/assay/index.test.ts`

- [ ] Test: `runs: 1` (default) adds no provenance.
- [ ] Test: `runs: 2` with two stubs that disagree on one topic stamps that row provisional + single-proposer-run; the shared row is stable unless volatile.
- [ ] `AssayOptions.runs?: 1 | 2`, `clientForSample?: (sample: number) => ProposalClient`.
- [ ] Commit `feat(assay): runs: 2 proposes twice and merges`

### Task 4: types on the published row and stamp

**Files:** Modify `src/types.ts` (`LedgerRow.provenance?`, `ReplayManifest.samples?`, `runs?`), `src/assay/types.ts` (`Audit.runDisagreement?`). `buildReport` does not stamp provenance; `mergeRuns` does.

- [ ] Existing report fixtures / Tesla JSON still typecheck (optional fields).
- [ ] Commit `feat(types): optional row provenance and replay.samples`

(Fold into Task 3 if types must move with assay. Prefer one commit with Task 3.)

### Task 5: CLI and replay

**Files:** `src/cli/args.ts`, `args.test.ts`, `src/cli/index.ts`, `src/cli/replay.ts`, `src/cli/replay.test.ts`, `src/pipeline.ts`

- [ ] `--runs` VALUE, default 2 for fresh/`--rerun`. Must be 1 or 2. Excluded with `--replay`, `--render`, `--fetch-only`, `--refresh` without `--rerun`.
- [ ] Fresh path: two `withProposalCache` clients; stamp `keys` = sample 0, `samples` both lists, `runs: 2`.
- [ ] `--runs 1`: one client, 3a stamp shape (no `samples`, no `runs` or `runs: 1`).
- [ ] `runReplay`: `runs = saved.replay.runs ?? 1`; `clientForSample`.
- [ ] Child-process: committed Tesla `--replay` identical, exit 0.
- [ ] Commit `feat(cli): default two proposer samples; replay reads the stamp`

### Task 6: renderers

**Files:** `src/report/render/terminal.ts`, `html.ts`, `markdown.ts` and their tests.

- [ ] With provenance: class on the claim line; footer `provenance: N stable · M provisional (reasons…)`.
- [ ] Without provenance: byte-identical to today's render for a Tesla-shaped fixture (no footer).
- [ ] Commit `feat(render): show stable/provisional when the row carries it`

### Task 7: README

**Files:** `README.md` only.

- [ ] New runs take two samples. Tesla's committed ledger is still one sample and has no per-row class. First characterised Tesla is a later paid `runs: 2` re-run.
- [ ] Development test count from `npm test`.
- [ ] Commit `docs(readme): two samples, Tesla still a single run`

After Task 7: `npm test`, `npm run typecheck`, `npm run replay` → `1 replayed, 3 not replayable`, `npm run cli -- tesla --replay reports/tesla-fsd.json` → identical.
