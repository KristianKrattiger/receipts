# Double Proposer Run and Row Provenance — Design Spec (Phase 3b)

**Date:** 2026-09-12
**Status:** approved
**Parent:** [`2026-09-09-assay-reproducible-ledgers-design.md`](2026-09-09-assay-reproducible-ledgers-design.md), Phase 3, second half
**Depends on:** [`2026-09-11-proposal-cache-replay-design.md`](2026-09-11-proposal-cache-replay-design.md) (Phase 3a), landed on `main`

## Summary

A second proposer sample, keyed `sample: 1` in the 3a cache, merged inside
`assay` with the first. Each admitted row is stamped `stable` or `provisional`
with reasons. `--replay` of a 3a Tesla report stays a single sample and stays
identical. No committed report is re-sampled on this branch.

This is the parent spec's "characterised" half of Phase 3. Exact replay shipped
in 3a. 3b discloses proposer variance.

## Decisions locked

Copied from the parent; not reopened:

1. Key admitted rows as `(topic, sides sorted by docId+start)`.
2. Compare only passes that succeeded in **both** runs. A pass that errored in
   one run must not silently demote its rows as `single-proposer-run`.
3. Class rules, applied in this order after the pass-scope filter:
   - in all compared runs → `class: "stable"`
   - in some compared runs → `provisional` + `single-proposer-run`
   - from a pass that failed in either run → `provisional` + `pass-failed`
   - any side whose doc is `volatile` → downgrade to `provisional` + `volatile-source`
   - any side whose doc id is in the caller-supplied `stabilityViolated` set →
     `provisional` + `stability-violated`
4. Outcome disagreement (ledger vs `BELOW_THRESHOLD`) is a **ledger**, every
   row `provisional`, `audit.runDisagreement = true`. Structural refusals
   (`CORPUS_INSUFFICIENT`) are computed before any model call and cannot disagree.
5. Ships `runs: 1 | 2` only. N-run quorum stays out of scope.
6. Renderers show per-row class when present, and a provenance footer.
7. MCP/web still inject no client. Do not backfill Claude/Vercel/Chime. Do not
   read `usage` for cost.

Locked against 3a as it actually shipped (the parent cache-key shape is obsolete):

8. The cache is request-addressed via `withProposalCache(inner, { sample })`.
   Sample `1` is a miss against sample `0` (already tested in 3a).
9. `cacheOnlyClient` must take `sample` (today it always keys `0`). Replay of
   a second sample misses until this lands.
10. `ReplayManifest` gains an optional `samples: { sample: number; keys: string[] }[]`.
    A 3a report with `sample: 0` and one `keys` array, and no `samples` field,
    replays as `runs: 1`.
11. `LedgerRow.provenance?` is optional. Tesla's committed report predates 3b —
    absent class is "not recorded", never invented as `stable`.
12. **No paid Tesla double-run on this branch.** Prove merge + replay on stubs.
    After 3b merges, a later owner `--refresh --rerun` with `runs: 2` produces
    the first characterised Tesla ledger.
13. Double-run lives **inside** `assay`, not the CLI. The CLI supplies a client
    per sample. Merging outside assay would make `src/assay/` a single-sample
    core and break the GIN contract the parent named.

## Goals

- `assay(..., { runs: 2 })` produces a ledger whose every row carries
  `RowProvenance`.
- A byte-identical corpus with both samples cached replays identically, offline.
- A 3a Tesla `--replay` is unchanged: exit 0, no `provenance` on rows.
- CI still prints `1 replayed, 3 not replayable`.

## Non-goals

- Re-running Tesla (or any committed report) through the model.
- Defaulting `runs: 2` on `--replay` of a 3a stamp.
- Wiring `stabilityViolated` from `--refresh` into `assay` (the merge function
  accepts the set; the CLI passes empty). Refresh already reports
  `STABILITY_VIOLATED` on the drift report.
- Changing `proposeAcrossPasses`.
- MCP, web, Claude/Vercel/Chime backfill, usage accounting, archive submission.

## Architecture

```
src/assay/merge.ts                 mergeRuns — pure
src/assay/index.ts                 assay loops samples, then mergeRuns when runs=2
src/provenance/proposal-cache.ts   cacheOnlyClient({ sample })
src/cli/index.ts                   two cached clients; stamp samples[]; default runs=2
src/cli/replay.ts                  runs from the stamp; clientForSample(sample)
src/report/render/{terminal,html,markdown}.ts
```

`runs: 1` is today's assay: one `proposeAcrossPasses`, no `row.provenance`.
That is what Tesla replay needs.

`runs: 2` calls `proposeAcrossPasses` twice (sample 0, then 1), admits each
proposal set separately, assembles each into an `AssayResult`, then
`mergeRuns`.

## Components

### `src/assay/merge.ts`

```ts
export function rowKey(row: LedgerRow): string
export function passIdOf(proposalId: string): string
export function mergeRuns(
  a: AssayResult,
  b: AssayResult,
  opts: {
    failuresA: { passId: string }[]
    failuresB: { passId: string }[]
    docs: PinnedDoc[]
    stabilityViolated?: Set<string>
  },
): AssayResult
```

`rowKey`: `canonicalJson({ topic, sides: sorted by (docId, start), each { docId, start } })`.
Status and statement are not in the key — two samples may word the statement
differently; the topic and the cited spans are the identity.

`passIdOf`: the prefix of `proposalId` before the first `:`. Today's ids are
`${pass.passId}:p${i}`. A proposal with no colon is pass `"all"`.

Admitted rows do not carry `proposalId` today. `mergeRuns` does not see
proposals; it sees assembled ledgers. Pass-scoping therefore needs the pass
id on the row **during merge only**. `assay` stamps a transient
`proposalId` onto each admitted row internally, or passes the admitted
proposal ids alongside. Spec choice: add optional `proposalId?` on
`LedgerRow`, set by `buildReport` from `a.proposal.proposalId`, omitted from
JSON if we strip it before write… cleaner: **keep `proposalId` off the
published row**. `assay` keeps each sample's `AdmitResult` and `FannedProposals.failures`
and `mergeRuns` receives those, not just the assembled ledgers.

Revised signature (this is the one to implement):

```ts
export function mergeRuns(
  a: AssayResult,
  b: AssayResult,
  opts: {
    admittedA: { rowKey: string; passId: string }[]
    admittedB: { rowKey: string; passId: string }[]
    failuresA: { passId: string }[]
    failuresB: { passId: string }[]
    docs: PinnedDoc[]
    stabilityViolated?: Set<string>
  },
): AssayResult
```

`assay` builds `admitted*` from each sample's `AdmitResult` after `admit`,
using the same `rowKey` function on the assembled row (topic + anchored
sides). Pass id comes from the proposal id.

**Pass-scope:** let `failed = { passIds that appear in failuresA or failuresB }`.
A row whose `passId` is in `failed` is **excluded from the in-all / in-some
comparison**. It still appears in the merged ledger if it was admitted in the
successful run, tagged `provisional` + `pass-failed`. It is not tagged
`single-proposer-run` merely because the other sample never produced it.

**Union of rows:** the merged ledger's row set is the union of keys from both
ledgers (after assembling each). For a key present in both, keep sample 0's
row body (statement, status, sides) and stamp class. For a key present in one,
keep that row and stamp. Sample 0 wins ties so replay is deterministic.

**Class, for a key whose pass succeeded in both runs:**

| Presence | class | reasons (then apply downgrades) |
|---|---|---|
| both | `stable` | `[]` |
| one | `provisional` | `["single-proposer-run"]` |

Then, if any side's doc is `volatile`, set `provisional` and add
`volatile-source` (do not remove other reasons). If any side's `docId` is in
`stabilityViolated`, add `stability-violated` and set `provisional`.

A `stable` row with a volatile side is therefore `provisional` +
`volatile-source`. That is the parent rule "any side whose doc is volatile →
downgrade".

**Outcome disagreement:**

- Both ledgers → merge as above. `runDisagreement` absent/false.
- One ledger, one `BELOW_THRESHOLD` → the ledger, every row `provisional`
  (existing reasons plus the disagreement does not add a new reason code;
  `audit.runDisagreement = true`).
- Both `BELOW_THRESHOLD` (or the same refusal reason) → that refusal,
  `runDisagreement` absent.
- Either `CORPUS_INSUFFICIENT` / `NO_GROUNDING` / `CONFLICTING_UNRESOLVABLE`:
  structural or assemble-time. If they agree, return it. They cannot disagree
  on `CORPUS_INSUFFICIENT` given the same corpus. If they somehow disagree on
  `NO_GROUNDING` vs ledger, treat as ledger + `runDisagreement` (same as
  BELOW_THRESHOLD): do not discard grounded rows.

`Audit` on a merged ledger: `proposed` is the sum of both samples' proposed
counts; `admitted` is the merged row count; `denied` is sample 0's denied list
(deterministic; sample 1's denials are not mixed in); `passes` is sample 0's
pass count (the plan of passes is a function of the corpus, identical);
`runDisagreement?: true` only when set.

### `src/assay/index.ts`

```ts
export interface AssayOptions {
  threshold?: number
  conflictMode?: "report" | "converge"
  candidates?: number
  concurrency?: number
  runs?: 1 | 2
  client?: ProposalClient
  clientForSample?: (sample: number) => ProposalClient
  stabilityViolated?: Set<string>
}
```

- `runs` defaults to `1`.
- Sample `s` uses `clientForSample?.(s) ?? client`. Missing both is today's
  `defaultClient` inside `proposeRelations`.
- `runs: 1`: identical to today. No `row.provenance`.
- `runs: 2`: two propose+admit+assemble cycles; `mergeRuns`; every published
  row has `provenance`.

`proposeAcrossPasses` is unchanged. The cache decorator, not the assay, is
what distinguishes samples — the CLI (or a test) passes a client whose key
includes `sample`.

If sample 0 throws `every proposal pass failed` and sample 1 would not, still
throw: an outage is not a finding. `mergeRuns` only sees two `AssayResult`s.

### `src/types.ts` / `src/assay/types.ts`

```ts
export interface LedgerRow {
  // …existing fields
  provenance?: RowProvenance
}

export interface Audit {
  // …existing
  runDisagreement?: true
}

export interface ReplayManifest {
  sample: number            // 3a: 0. 3b: still 0, meaning "primary sample"
  keys: string[]            // 3a + 3b: sample 0 keys, call order
  samples?: { sample: number; keys: string[] }[]  // 3b only; length 2
  model: string
  candidates: number
  threshold: number
  conflictMode: "report" | "converge"
  runs?: 1 | 2              // absent ⇒ 1
}
```

Tesla today has no `samples`, no `runs`. Replay treats that as `runs: 1`.

### `src/provenance/proposal-cache.ts`

`cacheOnlyClient(opts?: { dir?: string; sample?: number })`. Default `sample`
is `0` so existing tests stay green. 3b replay of sample 1 passes `sample: 1`.

`withProposalCache` already takes `sample`. No change except using it from
the CLI for sample 1.

### `src/cli/`

- Default for a **fresh** run and `--refresh --rerun`: `runs: 2`.
- `--runs <1|2>` VALUE flag if we need an escape; otherwise no flag, default 2
  for new runs. Spec: **add `--runs`**, default 2, refuse values other than
  1 or 2, incompatible with `--replay` (replay reads the stamp) and with
  `--render` / `--fetch-only` / plain `--refresh` (no model).
- Stamp: `keys` = sample 0 keys; `samples: [{sample:0, keys: c0.keys}, {sample:1, keys: c1.keys}]`;
  `runs: 2`; `sample: 0`.
- `--no-cache`: still no stamp; still two live samples if `runs: 2`.
- Replay: `runs = saved.replay.runs ?? 1`. For each sample in
  `saved.replay.samples ?? [{ sample: 0, keys: saved.replay.keys }]`,
  `cacheOnlyClient({ sample })`. `replayed` is the total keys served.

`--replay` of Tesla: `runs` absent, one client at sample 0, result has no
`provenance`, comparable() still strips `generatedAt` and `replay` only —
identical.

### Renderers

When `row.provenance` is present, append a short class mark on the claim line:

```
  Engaging FSD lowers your collision likelihood  [topic]  provisional
```

Terminal: `stable` / `provisional` after the topic. HTML: a `.prov` span,
muted. Markdown: `_provisional_` / `_stable_`.

After the audit line, when any row has `provenance`:

```
  provenance: 4 stable · 15 provisional (12 volatile-source, 3 single-proposer-run)
```

Reason counts are of rows that carry that reason (a row can contribute to
more than one). Order: `volatile-source`, `single-proposer-run`,
`pass-failed`, `stability-violated`. Omit a reason with count 0. If
`audit.runDisagreement`, append ` · run disagreement`.

Absence of `provenance` on every row: print nothing extra (Tesla 3a, Claude,
Vercel, Chime).

## Data flow

### Fresh CLI (`runs: 2`, default)

1. Corpus as today (`storeCorpus`, pins).
2. `c0 = withProposalCache(raw, { sample: 0 })`, `c1 = withProposalCache(raw, { sample: 1 })`.
3. `assay(..., { runs: 2, clientForSample: s => s === 0 ? c0 : c1 })`.
4. Stamp `replay` from both clients' keys if neither has write/call failures.
5. Render, including provenance footer.

### `--replay` of a 3a Tesla report

1. Load; `runs` absent → 1.
2. `cacheOnlyClient({ sample: 0 })`.
3. `assay` once. No `provenance` on rows.
4. Diff. Identical.

### `--replay` of a 3b report (stub-proven; none committed)

1. `runs: 2`, two cache-only clients.
2. `assay` merges. Provenance is part of the comparable JSON (not stripped).
3. Identical iff merge is deterministic — asserted by test.

## Error handling

Same sentences as 3a for cache misses, plus: `--runs` with a value other than
`1` or `2` → `receipts: --runs must be 1 or 2`. `--runs` with `--replay` →
`receipts: --replay reads runs from the report; do not pass --runs`.

## Testing

All hermetic.

- `rowKey` order-insensitive on sides; sensitive to topic, docId, start.
- `mergeRuns`: both → stable; one → single-proposer-run; volatile side
  downgrades; stabilityViolated set; pass failed in B does not mark A's row
  single-proposer-run, marks pass-failed; ledger vs BELOW_THRESHOLD →
  runDisagreement, all provisional; two identical ledgers → strictly equal
  twice (determinism).
- `assay` `runs: 1` adds no provenance (Tesla-replay contract).
- `assay` `runs: 2` with two stub clients that disagree on one topic stamps
  that row provisional.
- `cacheOnlyClient({ sample: 1 })` misses a sample-0 file.
- CLI: default `--runs` is 2 on a child-process `--help`/USAGE; `--replay`
  of committed Tesla still identical, exit 0, no provenance in the
  reproduction's comparable JSON.
- Render: a row with provenance prints the class; a Tesla-shaped report
  without provenance does not grow a footer.
- `npm run replay` still `1 replayed, 3 not replayable`.

## README

Under "Replaying a ledger": new CLI runs take two samples; a row that
survives both and rests only on stable docs is `stable`; otherwise
`provisional` with reasons. Tesla's committed ledger is still one sample and
does not carry per-row class. The first characterised Tesla ledger is a
later paid `runs: 2` re-run, not this branch.

## Migration

None. 3a Tesla parses. Replay stays green. New reports grow optional fields.
