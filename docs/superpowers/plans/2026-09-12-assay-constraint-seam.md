# Assay Constraint Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/assay/` owns the GIN_14 contract and imports nothing from Receipts; Tesla `--replay` stays identical; CI stays `1 replayed, 3 not replayable`.

**Architecture:** Move contract types into Assay; move `toPinnedCorpus` to provenance; assemble builds the ledger; Anthropic SDK and cache stay Receipts, adapted through `toAssayClient`; isolation test enforces the import rule.

**Tech Stack:** TypeScript ESM, vitest, tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-12-assay-constraint-seam-design.md`.

## Global Constraints

- Node ESM `.js` specifiers. `npm run typecheck` clean after every task.
- No new runtime dependencies.
- Runtime and test files under `src/assay/` import only `src/assay/` plus `zod` / `vitest` / `node:*`.
- Tesla cache keys unchanged: cache still hashes the Anthropic parse body.
- Nothing under `reports/`, `snapshots/`, `cache/`, `fixtures/` in git. `npm run replay` stays `1 replayed, 3 not replayable`.
- No `console.error` / `process.env` in Assay.
- Prose must not claim Assay is a published package.
- `npm test` and `npm run typecheck` before every commit.

## File map

| File | Responsibility |
|---|---|
| `src/assay/types.ts` | Contract types Assay owns |
| `src/types.ts` | Fetch/plan/drift + re-exports |
| `src/provenance/adapt.ts` | `toPinnedCorpus` (moved) |
| `src/assay/assemble.ts` | Ledger construction; no `report/build` |
| `src/cartographer/anthropic.ts` | `MODEL`, SDK client, `toAssayClient` |
| `src/assay/cartographer/propose.ts` | Pass fan-out + `propose({system,user})` |
| `src/provenance/proposal-cache.ts` | Still wraps parse-shaped SDK client |
| `src/assay/isolation.test.ts` | Import rule |
| `README.md` | Honest lineage |

---

### Task 1: Types live in Assay

**Files:** `src/assay/types.ts`, `src/types.ts`, Assay module imports.

- [ ] Move Pin, Stability, SourceRole, SourceKind, RoleLabels, DEFAULT_LABELS, FetchVia, FailureReason, SourceFailure (no Egress), Chunk, proposal/admit/row types, DocSummary, ReplayManifest into `src/assay/types.ts`. Keep PinnedDoc / PinnedCorpus / Ledger / Refusal there. `isRefusal` is structural; do not import `Report`.
- [ ] `src/types.ts` re-exports those names and keeps FetchedDoc, Corpus, SourcePlan, Egress, Drift*, Report.
- [ ] Assay runtime files import `../types.js` or `./types.js` (assay), never `../../types.js`.
- [ ] `npx vitest run src/assay` and `npm run typecheck` PASS.
- [ ] Commit `refactor(assay): own the contract types`

### Task 2: Internals take PinnedDoc

**Files:** `chunk.ts`, `independence.ts`, `admit.ts`, `propose.ts` (docs param), Assay tests.

- [ ] `chunkAll` / `chunkDoc` take `{ docId, text }`. `claimantDomains` takes docs with `{ url, role }`. `admit` takes `PinnedCorpus`. Tests build `PinnedDoc`s; no `FetchedDoc` / `driftHashOf` imports from Assay tests.
- [ ] Commit `refactor(assay): internals take pinned docs, not FetchedDoc`

### Task 3: Move toPinnedCorpus

**Files:** Move `src/assay/adapt.ts` → `src/provenance/adapt.ts` (tests with it). Update `pipeline.ts`, `cli/replay.ts`.

- [ ] Assay folder has no `adapt.ts`.
- [ ] Commit `refactor(provenance): toPinnedCorpus leaves Assay`

### Task 4: Assemble owns the ledger

**Files:** `src/assay/assemble.ts`, `src/report/build.ts`.

- [ ] Fold `rowStatus` and the mapping into assemble. Assemble does not import `report/build`. `report/build.ts` re-exports for existing `build.test.ts`.
- [ ] Commit `refactor(assay): assemble builds the ledger`

### Task 5: Anthropic adapter

**Files:** Create `src/cartographer/anthropic.ts`. Modify `propose.ts`, `proposal-cache.ts`, `analyze-live.ts`, `pipeline.ts`, `cli/replay.ts`, stubs.

- [ ] Assay `ProposalClient.propose({ system, user })`. Missing client throws. No SDK, no `defaultClient`, no `MODEL` in Assay.
- [ ] Receipts: parse-shaped `defaultClient` + `toAssayClient`. Cache still wraps parse. Tesla request body identical (model, max_tokens 16000, same SYSTEM, same user, `betaZodOutputFormat(ProposalBatchSchema)`).
- [ ] Pass-failure `console.error` moves to `analyzeCorpus` (or `analyzeLive`); Assay returns failures only.
- [ ] Commit `refactor: Anthropic adapter lives in Receipts`

### Task 6: Isolation test + README

**Files:** `src/assay/isolation.test.ts`, `README.md`.

- [ ] Walk `src/assay/**/*.ts`; relative imports must resolve inside `src/assay/`.
- [ ] README Lineage: Assay is the constraint; Receipts is the field instance; the folder has no imports into Receipts; not a published package.
- [ ] `npm test`, `npm run typecheck`, `npm run replay` → `1 replayed, 3 not replayable`, Tesla `--replay` identical.
- [ ] Commit `test(assay): isolation from Receipts` and `docs(readme): Assay is in-repo constraint tooling`

After Task 6: Tesla `--replay` identical. No paid re-run.
