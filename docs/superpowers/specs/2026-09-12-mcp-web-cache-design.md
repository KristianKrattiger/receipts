# MCP and Web Snapshot Store + Proposal Cache — Design Spec

**Date:** 2026-09-12
**Status:** approved
**Parent:** [`2026-09-09-assay-reproducible-ledgers-design.md`](2026-09-09-assay-reproducible-ledgers-design.md)
**Depends on:** [`2026-09-11-proposal-cache-replay-design.md`](2026-09-11-proposal-cache-replay-design.md) (3a), [`2026-09-12-double-run-provenance-design.md`](2026-09-12-double-run-provenance-design.md) (3b), both on `main`

## Summary

The MCP and web live paths commit fetched bytes to `snapshots/` and model
responses to `cache/proposals/`, then stamp `replay` on the in-memory result —
the same disk contract as the CLI. They still return markdown and HTML, not a
committed `reports/*.json`. Tesla stays the only committed replayable ledger.
CI stays `1 replayed, 3 not replayable`.

3a and 3b deferred this on purpose: those entry points injected no client and
pinned `hash`. The parent architecture already named CLI / MCP / web as the
machinery that owns the store and the cache.

## Decisions locked

1. **Extract, do not copy.** The CLI's store → cached clients → `analyzeCorpus`
   → stamp tail becomes one function, `analyzeLive`. CLI, MCP, and web all call
   it. `--no-cache` and `--runs 1` stay CLI-only flags passed through.
2. **Same cwd-relative dirs as the CLI:** `snapshots/` and `cache/proposals/`.
   A process started from the repo writes the same trees a CLI run would.
3. **`runs: 2` on MCP and web** (the CLI default). Live ledgers from those
   entry points get per-row provenance.
4. **Do not write `reports/*.json`.** MCP still returns markdown; web still
   returns HTML. The in-memory `AssayResult` carries `replay` when every
   response is on disk. An operator who wants a `--replay` file uses the CLI.
5. **Stamp rule unchanged:** no `replay` if `noCache`, a cache write failed, or
   a call threw.
6. **No paid Tesla re-run. No Claude/Vercel/Chime backfill.** Committed reports
   and `npm run replay` stay `1 replayed, 3 not replayable`.
7. **`src/assay/` stays disk-agnostic.** The cache remains a client. `analyzeLive`
   is Receipts machinery, not Assay.

Rejected: duplicating store+cache in MCP and web (would drift from the CLI).
Rejected: store-only without the cache (pins would be `snapshot` but the
result would still not be replayable by the 3a definition). Rejected: MCP/web
writing `reports/<subject>.json` (pollutes the repo on a local MCP session;
the web demo's disk is ephemeral).

## Goals

- A live MCP or web run that successfully analyses a corpus pins `snapshot`
  (or `permalink`), not `hash`, for every document whose bytes were committed.
- That run's model calls go through `withProposalCache`. Default two samples.
- When every response is on disk, `result.replay` is stamped (`runs: 2` includes
  `samples`). Renderers already show class and a provenance footer.
- Store-write failure is the CLI's existing conservative path: warn on stderr,
  continue, pins fall back to `hash`, no false `snapshot`.
- Tesla `--replay` stays identical. `npm run replay` stays `1 replayed, 3 not`.

## Non-goals

- Persisting MCP/web output as `reports/*.json`.
- Claude/Vercel paid `--refresh --rerun`.
- Chime fixture / pins.
- Wikipedia `oldid` / archive submission.
- Wiring `stabilityViolated` into assay; printing `usage`.
- Changing `--replay`, the committed Tesla ledger, or CI's replay count.

## Architecture

```
src/analyze-live.ts     analyzeLive — store, cache, assay, stamp
src/cli/index.ts        fetch-only keeps its own store; analyse path calls analyzeLive
src/mcp/server.ts       runDiligence → analyzeLive → renderMarkdown
src/web/server.ts       /run → analyzeLive → renderHtml
```

`analyzeCorpus` in `src/pipeline.ts` stays the Assay lift (pins + assay). It
does not touch the filesystem. `analyzeLive` is the machinery wrapper.

MCP uses stdio for the protocol. `analyzeLive` must not write to stdout.
Warnings go to stderr, as the CLI already does.

## Components

### `analyzeLive`

```ts
export async function analyzeLive(
  corpus: Corpus,
  opts?: {
    runs?: 1 | 2
    noCache?: boolean
    candidates?: number
    client?: ProposalClient
    snapshotDir?: string
    cacheDir?: string
  },
): Promise<AssayResult>
```

- `runs` defaults to `2`. MCP and web pass nothing. CLI passes `opts.runs`.
- `noCache` defaults false. CLI `--no-cache` passes true: live `defaultClient`
  (or the injected `client`) twice, no stamp.
- `client` is for tests (a stub). Absent: `defaultClient()`.
- Dirs default to `SNAPSHOT_DIR` and `CACHE_DIR`.

Sequence:

1. `storeCorpus` in a try/catch. On throw: stderr warning (CLI's two sentences),
   empty stored set. On success: pins can be `snapshot`.
2. Build per-sample cached clients unless `noCache`.
3. `analyzeCorpus` with `isStored`, `runs`, `clientForSample`, `candidates`.
4. Stamp `replay` using the same shapes the CLI uses today (`runs: 2` →
   `samples` + `runs: 2`; `runs: 1` → 3a shape, no `samples`). Skip the stamp
   on `noCache` or any write/call failure.
5. Return the result. Throw if the model call throws — callers handle it.
   Store already happened; a later throw must not un-commit blobs.

CLI `--fetch-only` does **not** call `analyzeLive`. It keeps its own
`storeCorpus` then exits, so a fetch-only run still commits bytes and still
makes no model call.

### CLI

Replace the analyse-path store + cache + `analyzeCorpus` + stamp block with
`analyzeLive`. Keep: snapshot count on stderr, cache count / not-replayable
sentences, workspace-id / model-error `die()`, `--refresh --rerun` JSON write,
`--json` / terminal render.

If `analyzeLive` already prints store-failure warnings, the CLI must not print
them twice.

### MCP / web

After a non-empty `fetchCorpus`:

```
const result = await analyzeLive(corpus)
return renderMarkdown(result)  // MCP
res.end(renderHtml(result))    // web
```

Missing-key checks stay before any fetch. Empty corpus stays the current
"no sources could be read" path (no store, no model).

## Testing

Hermetic. Temp dirs. Stub `ProposalClient`. No network, no key.

- `analyzeLive` with a two-doc corpus: pins `snapshot` (or `permalink`), not
  `hash`; `runs: 2` writes two key lists; `result.replay.runs === 2`;
  `result.replay.samples` length 2.
- `noCache: true`: no `replay` block.
- Store dir is a plain file: result still returns; pins are `hash`; no throw.
- MCP still refuses missing keys / empty name / unknown industry before fetch.
- Tesla `--replay` identical. `npm run replay` → `1 replayed, 3 not replayable`.

## README

A live CLI, MCP, or web run commits bytes and caches model responses. MCP and
web do not write a committed report file. Tesla remains the only committed
replayable ledger. Do not claim MCP/web output is in `reports/` or that CI
replays more than Tesla.

## Migration

None. Committed reports unchanged. Existing MCP/web callers get characterised
live ledgers the next time they run, and leave blobs in whatever cwd the
process was started from.
