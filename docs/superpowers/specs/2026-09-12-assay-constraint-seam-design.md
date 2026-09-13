# Assay Constraint Seam — Design Spec

**Date:** 2026-09-12
**Status:** approved
**Parent:** [`2026-09-09-assay-reproducible-ledgers-design.md`](2026-09-09-assay-reproducible-ledgers-design.md)
**Depends on:** MCP/web cache on `main` (`analyzeLive` owns store + cache)

## Summary

Invert the Assay/Receipts seam in this repo. `src/assay/` owns the GIN_14
contract — pinned documents and a query in, a grounded ledger or a refusal
out — and imports nothing from Receipts. Receipts is the field instance that
fetches, pins, caches, and renders. No new package. No publish.

The parent spec already drew this picture and then left the folder leaky:
contract types live in `src/types.ts`, `assemble` calls `report/build`,
`toPinnedCorpus` sits inside Assay, and the proposer is the Anthropic SDK.

## Decisions locked

1. **Import rule.** Runtime and test files under `src/assay/` import only from
   `src/assay/` plus third-party modules (`zod`, `node:*`). They do not import
   `src/types.ts`, `src/report/`, `src/provenance/`, `src/pipeline.ts`,
   `src/analyze-live.ts`, or any other Receipts tree. Enforced by a hermetic
   isolation test that walks those files.
2. **Receipts re-exports.** `src/types.ts` keeps fetch/plan/drift types
   (`FetchedDoc`, `Corpus`, `SourcePlan`, `Egress`, `DriftReport`) and
   re-exports Assay-owned types so existing Receipts imports need not churn.
   Owner is Assay; Receipts is the convenience barrel.
3. **Assay owns** `Pin`, `Stability`, `SourceRole`, `SourceKind`, `RoleLabels`,
   `DEFAULT_LABELS`, `FetchVia`, `FailureReason`, `SourceFailure` (no `Egress`),
   `Chunk`, proposal/admit/row types, `DocSummary`, `PinnedDoc` / `PinnedCorpus`,
   `Ledger` / `Refusal` / `AssayResult`, `ReplayManifest` (optional stamp
   Receipts writes), and an SDK-free `ProposalClient`.
4. **`Report` stays Receipts.** On-disk alias for a ledger that may omit
   `outcome` (chime/claude/vercel predate it). `isRefusal` in Assay is
   structural (`outcome === "refusal"`) and does not import `Report`.
5. **`toPinnedCorpus` leaves Assay.** Move to `src/provenance/adapt.ts`. Pin
   resolution stays machinery. `analyzeCorpus` and `--replay` keep calling it.
6. **Assemble builds the ledger.** Fold `rowStatus` and the doc/row mapping
   into `assemble` over `PinnedCorpus`. `report/build.ts` may re-export for
   existing tests; Assay does not import it.
7. **Anthropic leaves Assay.** `ProposalClient` is `{ propose({ system, user })
   }` returning `{ proposals, stopReason?, stopCategory? }` — no SDK types.
   `defaultClient`, `MODEL`, and the `beta.messages.parse` wrapper live in
   Receipts (`src/cartographer/anthropic.ts`). `analyzeLive` / `analyzeCorpus`
   inject `client ?? toAssayClient(defaultClient())`. Assay `propose.ts` keeps
   pass fan-out, excerpt assembly, SYSTEM prompt, and the Zod schema.
8. **Tesla cache keys unchanged.** The proposal cache continues to hash the
   Anthropic parse body (`model`, `system`, `messages`, `max_tokens`,
   `output_format`). `withProposalCache` / `cacheOnlyClient` wrap the
   parse-shaped SDK client. A Receipts adapter (`toAssayClient`) translates
   to Assay's `propose()`. Changing the hashed body is a Tesla miss.
9. **No `console.error` / `process.env` in Assay.** Pass-failure stderr moves
   to the Receipts caller (`analyzeCorpus` / `analyzeLive`). Workspace id stays
   in the Anthropic adapter. Missing client is an error Assay throws; Receipts
   always injects.
10. **Do not** publish, split a package, wire `stabilityViolated` from
    `--refresh` into assay, print `usage`, persist MCP/web `reports/*.json`,
    or paid-rerun Tesla/Claude/Vercel/Chime. CI stays `1 replayed, 3 not
    replayable`. Committed JSON bytes unchanged.

Rejected: a `packages/assay` workspace (the user chose invert-in-repo).
Rejected: caching Assay's `propose({system,user})` body (would change Tesla
keys). Rejected: moving the SYSTEM prompt into Receipts (exact quotes,
claimant/independent, aggregator-as-conduit are the constraint;
`independence.ts` is the code half of the same rule).

## Goals

- A second field instance in this repo can call `assay(pinned, query, { client })`
  without importing fetch, Solari, snapshots, or `@anthropic-ai/sdk`.
- `src/assay/` has no imports into other `src/` trees.
- Tesla `--replay` identical. `npm run replay` stays `1 replayed, 3 not`.

## Non-goals

- npm publish, monorepo package, separate repo.
- Generalising the diligence prompt away from claimant/independent.
- Wiring `stabilityViolated` from live refresh; printing `usage`.
- Changing committed reports or CI's replay count.

## Architecture

```
Receipts                          src/assay
--------                          ---------
fetchCorpus
analyzeLive
  storeCorpus / proposal cache
  toPinnedCorpus  (provenance/adapt)
  toAssayClient(cachedSdkClient)
        |                         PinnedCorpus
        +-----------------------> chunk → select → propose
                                  admit → assemble / mergeRuns
        <-----------------------  Ledger | Refusal
render / replay / refresh
```

The load-bearing rule is unchanged: Assay never sees a URL it has to trust.
It may inspect `url` for the aggregator-as-conduit check (`independence.ts`).
Pins are resolved before `assay()` is called.

## Components

### `ProposalClient` (Assay)

```ts
export interface ProposalClient {
  propose(input: { system: string; user: string }): Promise<{
    proposals: Omit<RelationProposal, "proposalId">[]
    stopReason?: string | null
    stopCategory?: string | null
  }>
}
```

Assay `proposeRelations` builds the same SYSTEM string and user message it
does today, calls `client.propose`, and maps `proposalId`s. It does not call
`defaultClient()`. A missing client throws.

### Receipts Anthropic adapter

`src/cartographer/anthropic.ts`: `MODEL`, `defaultClient()` (SDK parse-shaped,
workspace header), `toAssayClient(sdkClient)` which builds the same parse
request as today's `propose.ts` (model `claude-opus-5`, `max_tokens` 16000,
`betaZodOutputFormat(ProposalBatchSchema)`).

`src/provenance/proposal-cache.ts` continues to wrap the parse-shaped client.

### Isolation test

`src/assay/isolation.test.ts`: for every `*.ts` under `src/assay/` (including
tests), each `from "..."` that starts with `.` must resolve inside
`src/assay/`. Package imports (`zod`, `vitest`, `node:*`) are allowed.

## Testing

Hermetic. No network, no key.

- Isolation test fails if any assay file imports Receipts.
- Existing assay tests pass with `PinnedDoc` fixtures and the new client
  shape (`propose:` not `beta.messages.parse`).
- Tesla `--replay` identical (16 responses). `npm run replay` → `1 replayed,
  3 not replayable`.

## README

Lineage: Assay is the GIN_14 constraint as code; Receipts is the live-web
field instance. `src/assay/` imports nothing from Receipts. Do not claim a
published package.

## Migration

None for committed reports. Import paths inside Assay change; Receipts keeps
importing contract types from `src/types.ts`.
