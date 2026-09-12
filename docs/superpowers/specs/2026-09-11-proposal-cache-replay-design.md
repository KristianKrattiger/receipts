# Proposal Cache and `--replay` — Design Spec (Phase 3a)

**Date:** 2026-09-11
**Status:** approved
**Parent:** [`2026-09-09-assay-reproducible-ledgers-design.md`](2026-09-09-assay-reproducible-ledgers-design.md), Phase 3, first half

## Summary

A content-addressed cache of every model response, committed to the repo, and a
`--replay` mode that rebuilds a committed ledger from `snapshots/` and the cache
with no network, no model call and no key — then says whether the result is
byte-for-byte the ledger that was committed.

This is the parent spec's "exact replay" half of Phase 3. The double proposer run
and per-row provenance classes are Phase 3b, on their own branch, and 3a leaves one
hook for them: the cache key carries a sample index.

## Decisions locked during brainstorming

1. **Split.** 3a (cache + replay) then 3b (double run + provenance classes), two
   branches. 3a is self-contained and testable offline; 3b builds on its cache.
2. **No committed report becomes replayable in 3a.** Every committed report predates
   the cache and the model's past responses were not recorded. `--replay` refuses
   them honestly. Replay is proven end to end on a stub-driven corpus. The first paid
   run through the CLI after this ships produces the first replayable report; when
   and whether to spend that is the owner's call, not this branch's.
   **Planned (owner, 2026-09-11):** once 3a is merged and clean, one paid
   `--refresh --rerun` against a committed report — a live Solari re-fetch, the
   first drift report against real fresh bytes, a fresh analysis through the cache,
   and a report that `--replay` can then reproduce. That run is the end-to-end
   test of 2b-ii and 3a together; until it happens the README says neither has
   been run live.
3. **Read-through by default; `--no-cache` for fresh samples.** A second run over a
   byte-identical corpus with the same settings hits every pass and is free and
   identical. `--no-cache` neither reads nor writes, so it can never overwrite what an
   earlier report replays from; its own report is not replayable and says so.

## Goals

- Every model response a CLI run makes is on disk, content-addressed by the request
  that produced it, and committed.
- `--replay <report>` reproduces a report from committed bytes alone and exits 0 iff
  the reproduction is identical.
- The report itself records what replays it.
- CI replays every replayable committed report on every push.

## Non-goals

- Backfilling caches for the four committed reports (impossible: the responses were
  never recorded).
- The double run, `runs: 2`, provenance classes, `runDisagreement` (3b).
- Reading `usage` for cost accounting. It is *recorded* here so it can be read later.
- Any change to the MCP or web entry points. They inject no client and pin `hash`;
  their reports were never replayable and stay that way.
- Cache pruning. Nothing is deleted; a pruned key is a replay failure by design.

## Architecture

```
src/provenance/proposal-cache.ts   withProposalCache(inner) / cacheOnlyClient() — ProposalClient decorators
src/cli/replay.ts                  runReplay(reportPath, deps) → { identical, diff, result }
scripts/replay-all.ts              loops reports/*.json for CI
cache/proposals/<sha256>.json      one committed file per model response
.github/workflows/ci.yml           typecheck, test, replay-all
```

**The cache is a client, not a layer in the assay.** `src/assay/` stays pure given
its `ProposalClient`. The CLI constructs the decorated client and passes it down
through `analyzeCorpus`, exactly as it passes `isStored` for the snapshot store.

**The key is the request itself.** `ProposalClient` is `{ beta.messages.parse(body) }`
and the proposer already builds a complete `ParseRequest` per pass — model, system
prompt, the user message with every excerpt, `max_tokens`, the JSON schema. The key
is `sha256(canonicalJSON({ sample, ...body }))`. Any change to any of those is a miss
with no version constant to bump.

**A report records what replays it**, in a `replay` block stamped by the CLI after
`analyzeCorpus`, next to where it already stamps pins.

## Components

### `src/provenance/proposal-cache.ts`

```ts
export const CACHE_DIR = "cache/proposals"   // cwd-relative, like SNAPSHOT_DIR

export interface CacheEntry {
  key: string
  createdAt: string
  sample: number
  request: unknown          // the ParseRequest as JSON — what was asked
  response: {
    parsed_output: unknown  // what the proposer reads
    stop_reason?: string | null
    stop_details?: { category?: string | null } | null
    usage?: unknown         // what the SDK returned, when it did; read by nothing yet
  }
}

export function cacheKeyFor(body: unknown, sample: number): string
export function withProposalCache(
  inner: ProposalClient, opts?: { dir?: string; sample?: number },
): ProposalClient & { keys: string[] }
export function cacheOnlyClient(opts?: { dir?: string }): ProposalClient & { keys: string[] }
```

- `cacheKeyFor`: `JSON.stringify` with object keys sorted at every depth. Functions
  do not survive JSON, so `output_format`'s `parse` contributes nothing and its schema
  contributes everything. `sample` is `0` for every 3a call.
- `withProposalCache.parse(body)`: compute the key; if `<dir>/<key>.json` reads and
  parses, return its `response` (no inner call); otherwise call `inner.parse(body)`,
  write the entry, return the response. Either way push the key onto `keys`, in call
  order. A corrupt file is a miss and gets overwritten. A write failure warns on
  stderr and continues — the run then must not be stamped replayable (see CLI).
- `cacheOnlyClient.parse(body)`: compute the key; return the stored response or throw
  `replay: no cached response for <key>`. A corrupt file throws naming the file — a
  miss is already fatal here, so nothing is silently a miss.
- The entry stores the **request too**. A cache you can read is a receipt; a bare
  response is not. Tesla's nine passes are roughly 1 MB, fine for git.
- The stored `response` is the subset the proposer reads plus `usage`. The client's
  raw return has content blocks, ids and headers that nothing reads; they are not kept.

### `src/cli/replay.ts`

```ts
export interface ReplayDeps { snapshot: typeof getSnapshot; client: ProposalClient }
export async function runReplay(
  reportPath: string, deps?: ReplayDeps,
): Promise<{ identical: boolean; diff: string[]; result: AssayResult; replayed: number }>
```

Refuses, in this order, before any other work, each with one sentence:

1. no `replay` block — "not replayable: no proposal cache recorded — generated before
   the cache existed, or with `--no-cache`";
2. any document whose `pin.kind` is `hash` — "not replayable: N documents' bytes were
   never committed (<labels>)";
3. a blob missing from `snapshots/` — naming label and sha256;
4. a stored blob whose `sha256(content)` is not its pin's — "snapshot <sha> does not
   match its own id — the store is corrupt". The store is content-addressed so this
   cannot happen by construction; it is checked because the parent spec says
   "verify each content hash", and a check that is free is not optional.

Then: rebuild `FetchedDoc[]` from `docs[]` plus each snapshot's content
(`title = label`, as `runRefresh` does; `fetchedAt` from the snapshot entry); carry
`failures` and `labels` from the report; `toPinnedCorpus(corpus, { isStored: () => true })`
so every pin comes back `snapshot` or `permalink` as the report recorded; run
`assay(pinned, { subject }, { client, candidates, threshold, conflictMode })` with the
recorded settings.

**Equality**: canonical JSON of the result and of the report, each with exactly two
fields removed — `generatedAt` and `replay`. Identical → `identical: true`. Otherwise
`diff` is a list of JSON-pointer-style paths with before/after values, one per leaf
that differs, e.g. `rows[3].status: "divergent" → "unverified"`. A saved refusal
replays the same way: `BELOW_THRESHOLD` has keys; `CORPUS_INSUFFICIENT` has none and
replays with zero cache reads.

`replayed` is the number of responses served from the cache, for the success line.

### `src/types.ts`

```ts
export interface ReplayManifest {
  sample: number
  keys: string[]                        // in call order
  model: string
  candidates: number
  threshold: number
  conflictMode: "report" | "converge"
}
```

`Report.replay?: ReplayManifest` and `Refusal.replay?: ReplayManifest`. `threshold`
and `candidates` are here because they shape the assay without appearing in any
request body. Nothing else changes shape; the four committed reports are untouched.

### `src/cli/args.ts`

- `--replay <report.json>` (VALUE). A mode: excludes `--from-fixture`, `--refresh`,
  `--render`, `--fetch-only`, `--snapshot`, `--no-cache`, in the file's existing
  exclusion shape and message register.
- `--no-cache` (BOOL). Rejected with `--render`, `--replay`, `--fetch-only`, and
  `--refresh` without `--rerun` — none of them calls the model, so there is nothing
  to skip; allowed with `--refresh --rerun` (a rerun that wants fresh samples).

### `src/cli/index.ts`

- Neither key is required for `--replay`; the key check's exemption list grows by
  one and its comment says why.
- Fresh-run path (and therefore `--refresh --rerun`): `client = opts.noCache ? raw
  : withProposalCache(raw, { sample: 0 })`, passed via `analyzeCorpus`'s `client`.
  After analysis, if the client is the cached one and it reported no write failure,
  stamp `report.replay`. With `--no-cache`, stderr: `not replayable: --no-cache`.
  After a write failure, stderr says which key and that the report is not replayable.
- `--replay` dispatch: `runReplay`; identical → stdout
  `replay: identical (N responses from cache)`, exit 0; differs → stdout the diff,
  one path per line, exit 1, stderr says this is a finding, not a failure; refusal or
  thrown miss → stderr the sentence, exit 1.

### `scripts/replay-all.ts` and `.github/workflows/ci.yml`

`replay-all` loops `reports/*.json`; for each with a `replay` block runs
`runReplay`; prints `N replayed, M not replayable` and the paths of any that differ;
exits 1 on any difference or operational failure, 0 otherwise — including when
`N = 0`, which is today's state, printed rather than hidden.

`ci.yml` on push and pull request: `npm ci`, `npm run typecheck`, `npm test`,
`npx tsx scripts/replay-all.ts`. The suite's one network-touching test (a fake Solari
key, bounded at 60 s) runs as it does locally.

## Data flow

### Fresh run (`cli -- tesla --from-fixture fixtures/tesla-fsd.json`)

1. Corpus → `storeCorpus` (unchanged) → `client = withProposalCache(new Anthropic(...))`.
2. `analyzeCorpus(corpus, { client, candidates, threshold, conflictMode, isStored })`.
   Each pass builds its `ParseRequest`; the decorator hashes it. First run: nine
   misses, nine model calls, nine files. Same fixture and flags again: nine hits, no
   model call, and — because the assay is deterministic given identical responses —
   an identical ledger. That determinism is asserted by a test, not assumed.
3. Stamp `replay` and write the report.

### `--replay reports/x.json`

1. Load; refuse per the four conditions above.
2. Rebuild the corpus from `docs[] × snapshots/`; `failures`/`labels` from the report.
3. `assay()` with `cacheOnlyClient()` and the recorded settings. A miss throws naming
   the key — the "cache pruned or never committed" case.
4. Compare. Exit 0 / 1.

### Not in the flow

The MCP and web entry points inject no client and are unchanged.

## Error handling

| Where | Condition | Behaviour |
|---|---|---|
| decorator, read-through | cache file unreadable or unparseable | a miss: call the model, overwrite |
| decorator, read-through | write fails (EROFS, permissions) | warn on stderr naming the key; continue; the run is not stamped |
| decorator, cache-only | miss | throw `replay: no cached response for <key>` |
| decorator, cache-only | file unparseable | throw naming the file |
| `--replay` | no `replay` block | refuse, exit 1 |
| `--replay` | a `hash` pin | refuse naming the documents, exit 1 |
| `--replay` | blob missing | refuse naming label and sha256, exit 1 |
| `--replay` | blob ≠ its id | refuse as corrupt, exit 1 |
| `--replay` | result differs | print the path diff, exit 1, stderr: a finding, not a failure |
| `args` | `--replay` with another mode or `--no-cache` | the existing exclusion pattern |

No stack traces on any of these; every one is a sentence.

## Testing

All hermetic: no network, no model, temp cwd, fake or absent keys.

- **Key**: order-insensitive at every depth; sensitive to each of system, message,
  model, `max_tokens`, schema, `sample`; a function-valued property changes nothing.
- **Decorator**: miss calls inner once and writes the entry with request and response;
  hit does not call inner and returns the stored response; `keys` lists every key
  served in order; corrupt file → miss (read-through) / throw naming file (cache-only);
  write failure → warn and continue with the inner response; cache-only miss → throw
  naming the key; `usage` stored when present, absent when not.
- **Assay determinism**: the same stub responses through `assay` twice →
  `toStrictEqual`. If this fails, exact replay is impossible and the plan stops.
- **`runReplay` unit** (deps injected): populate a temp cache by running
  `analyzeCorpus` with a stub client under `withProposalCache`; build the report
  with the stamp; write to temp. Then: replay identical, `replayed` = number of
  passes; mutate one row's `status` → `diff` names `rows[i].status`; strip `replay`
  → refused; set one doc's pin to `hash` → refused naming it; delete one cache file
  → throws naming the key; corrupt one blob → refused as corrupt; a saved
  `CORPUS_INSUFFICIENT` refusal → identical with `replayed = 0`.
- **CLI, child process**: `--replay` on a report with no `replay` block → exit 1 with
  the sentence and no key in the environment; `--replay` plus `--from-fixture` →
  rejected by `args` with the exact message; `--no-cache` with `--render` →
  rejected. The paid path stays untested, as today.
- **`replay-all`**: against the committed reports → `0 replayed, 4 not replayable`,
  exit 0; against a temp `reports/` with one replayable and one mutated → exit 1
  naming the mutated one.

## Migration

None. Committed reports lack `replay` and are refused by `--replay` with the sentence
above. The README says so.

## README

- A section under "What a pin is": the cache, the key, what a report records,
  `--replay` and its exit codes, `--no-cache`, and the honest limit: no committed
  report is replayable yet, the path is proven on a stub-driven corpus, the first paid
  run makes its report replayable.
- The "One caveat worth stating plainly: results vary between runs" paragraph
  narrows to: they vary when the corpus or settings differ, or with `--no-cache`;
  over a byte-identical corpus a run is served from the cache and is identical.
- The Development section names `cache/proposals/` beside `snapshots/` and the CI
  workflow.

## Phase 3b hook

`sample` in the key and in `ReplayManifest`. A double run passes `1` for its second
sample; its manifest records both key lists. Nothing else in 3a anticipates 3b.
