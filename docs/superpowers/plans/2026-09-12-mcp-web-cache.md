# MCP and Web Snapshot + Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MCP and web live paths commit snapshots and the proposal cache, stamp `replay`, and default to two proposer samples; Tesla `--replay` stays identical; CI stays `1 replayed, 3 not replayable`.

**Architecture:** `analyzeLive` in `src/analyze-live.ts` owns store → cache → `analyzeCorpus` → stamp. CLI analyse path, MCP `runDiligence`, and web `/run` call it. `analyzeCorpus` stays filesystem-free.

**Tech Stack:** TypeScript ESM, vitest, tsx. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-12-mcp-web-cache-design.md`.

## Global Constraints

- Node ESM `.js` specifiers. `npm run typecheck` clean after every task.
- No new runtime dependencies.
- `src/assay/` stays disk-agnostic.
- Nothing under `reports/`, `snapshots/`, `cache/`, `fixtures/`, `plans/` in git. Tesla `--replay` identical. `npm run replay` stays `1 replayed, 3 not replayable`.
- Tests hermetic: no network, no model; inject stub client and temp dirs.
- `analyzeLive` must not write to stdout (MCP stdio).
- Prose must not claim MCP/web publish a committed report, or that CI replays more than Tesla.
- `npm test` and `npm run typecheck` before every commit.

## File map

| File | Responsibility |
|---|---|
| `src/analyze-live.ts` (new) | `analyzeLive` |
| `src/analyze-live.test.ts` (new) | pins, stamp, noCache, store failure |
| `src/cli/index.ts` | analyse path delegates; fetch-only store stays |
| `src/mcp/server.ts` | `analyzeLive` after fetch |
| `src/web/server.ts` | `analyzeLive` after fetch |
| `README.md` | honest MCP/web disk contract |

---

### Task 1: analyzeLive

**Files:** Create `src/analyze-live.ts`, `src/analyze-live.test.ts`

- [ ] Tests first, against a two-role stub corpus (same shape as `src/cli/replay.test.ts`): `analyzeLive` pins `snapshot` not `hash`; `replay.runs === 2`; `replay.samples` has two key lists; `noCache: true` leaves `replay` absent; a `snapshotDir` that is a plain file does not throw and pins `hash`.
- [ ] Implement `analyzeLive` per the spec. Defaults `runs: 2`. Injected `client` wraps with `withProposalCache` unless `noCache`. Store-failure stderr matches CLI: `could not commit to <dir>/:` then `continuing with nothing committed -- pins will read hash, not snapshot`. Do not print cache lines (CLI still does).
- [ ] Stamp: `runs: 2` → `{ sample: 0, keys: c0.keys, samples: [{sample:0,keys:c0.keys},{sample:1,keys:c1.keys}], model: MODEL, candidates, threshold: DEFAULT_THRESHOLD, conflictMode: "report", runs: 2 }`. `runs: 1` → 3a shape (no `samples`, no `runs`).
- [ ] `npx vitest run src/analyze-live.test.ts` PASS.
- [ ] Commit `feat: analyzeLive stores bytes, caches proposals, stamps replay`

### Task 2: CLI delegates

**Files:** Modify `src/cli/index.ts`

- [ ] After fetch-only's existing `storeCorpus` + exit, the analyse path calls `analyzeLive` instead of inlined store/cache/stamp.
- [ ] Keep workspace-id / model-error `die()`, snapshot count on stderr, cache count / not-replayable sentences (derive from `result.replay` and opts), `--refresh --rerun` write.
- [ ] Existing CLI child-process tests still pass (blobs exist before a failing model call; store-as-file still warns).
- [ ] Commit `refactor(cli): analyse path uses analyzeLive`

### Task 3: MCP and web

**Files:** Modify `src/mcp/server.ts`, `src/web/server.ts`. Existing MCP key/name/industry tests stay.

- [ ] After a non-empty corpus, `const result = await analyzeLive(corpus)` then render.
- [ ] Empty corpus and missing-key paths unchanged.
- [ ] Commit `feat(mcp,web): live runs commit snapshots and the proposal cache`

### Task 4: README

**Files:** `README.md` only.

- [ ] The pin paragraph currently says MCP/web call `analyzeCorpus` with nothing stored. Update: live CLI, MCP, and web all go through `analyzeLive`. They still do not write `reports/*.json`. Tesla remains the only committed replayable ledger.
- [ ] Commit `docs(readme): MCP and web commit bytes and cache`

After Task 4: `npm test`, `npm run typecheck`, `npm run replay` → `1 replayed, 3 not replayable`, Tesla `--replay` identical.
