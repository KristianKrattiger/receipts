# Assay Extraction and Reproducible Ledgers — Design Spec

**Date:** 2026-09-09
**Status:** approved

## Summary

Two changes that are one change.

**First**, factor Receipts' propose→admit→render middle into `src/assay/`, a typed
core matching the contract named in the GIN series document `GIN_14_Assay`:
a set of documents and a query in; a grounded ledger or a refusal out. GIN_14 §7
names this explicitly — *"Receipts itself, rebuilt. Factoring the middle out and
depending on it would shrink Receipts to the parts that are actually about the live
web."* Refusal becomes a first-class outcome rather than an anemic ledger.

**Second**, make ledgers reproducible. Today `analyzeCorpus` claims to be a pure
function "given the same fixture and the same model output" — both qualifiers are
doing heavy lifting. The corpus changes when volatile sources are re-fetched, and
the proposer is a non-deterministic model call. This spec closes the first gap with
a **stable/volatile source classification and a pin discipline**, and characterises
the second with a **proposal cache** (exact replay) plus a **double proposer run**
(disclosed variance).

The two changes are one because the Assay's input type is where pinning has to
live. A contract that accepts a bag of URLs cannot promise anything about
reproducibility; a contract that accepts a `PinnedCorpus` gets it structurally.

## Motivation

The Sept-6 Tesla regeneration is the case study. A re-run silently lost the SEC
10-K to a proxy tunnel failure, dropped the ledger from 26 rows to 16, and shipped
a hosted page whose marquee finding no longer existed — while the README continued
to describe the older run in precise detail. Nothing in the system noticed, because
nothing in the system had an opinion about whether two runs of the same plan
*should* agree.

Three properties are missing:

1. **A ledger cannot be regenerated.** Re-running a plan produces a different
   ledger for two independent reasons (corpus drift, proposer variance), and the
   tool cannot tell you which reason applied.
2. **A ledger cannot be replayed.** The bytes behind a published claim are not
   addressable. `fixtures/` holds some corpora by convention, not by contract.
3. **A source's volatility is invisible.** A row resting on an SEC filing and a row
   resting on a Hacker News search have identical standing in the output, though
   only one of them will still be there next week.

## Goals

- A published ledger is **replayable**: anyone with the repo regenerates it
  byte-identically, offline, with no API key.
- A published ledger is **characterised**: every row states whether it is `stable`
  (both sources pinned, survived both proposer runs) or `provisional`, with reasons.
- Re-running a plan produces a **drift report** naming which sources changed and
  which rows those changes moved.
- The Assay contract is a real seam with real types, not a comment.

## Non-goals

- Bitwise reproducibility from a *live re-fetch*. Volatile sources make this
  impossible, and pretending otherwise is the failure mode this tool exists to
  catch. The honest target is replay plus characterised drift.
- Publishing `assay` as a standalone package. In-repo extraction first; the seam
  earns a package later, if ever.
- Governing divergence. The Assay reports that the corpus disagrees with itself; it
  does not rule on the merits — that belongs to `GIN_07_Governance_Validity`.

## Decisions locked during brainstorming

1. **Reproducibility target: B/C, with C the honest one.** B (a source set + role
   framing reproduces a ledger) is the direction; C (grounded rows are stable,
   variance is bounded and disclosed, the stable/volatile split tells a reader which
   rows may drift) is what ships and what the docs will claim.

2. **Pinning is hybrid (Q2/D).** Native permalink where the source offers one
   (promote to `stable`); committed content-addressed snapshot otherwise; a
   normalized hash for drift detection on everything.

3. **Proposer determinism is cache + disclosure (Q3/B+D).** A content-addressed
   proposal cache gives exact replay. A double proposer run tags each row `stable`
   or `provisional`. N-run quorum is a later knob, not this cycle.

4. **Stability classification is layered (Q4/D).** `SourceKind` default → per-target
   `stability` override in the plan → empirical re-fetch check that can emit
   `STABILITY_VIOLATED` and downgrade a misdeclared source.

5. **Extraction is in-repo (Q5/B).** `src/assay/` with a typed entry point. Not a
   separate package.

6. **Refusal is a first-class outcome.** `AssayResult = Ledger | Refusal`. Zero
   admitted rows is a refusal with a reason code, not an empty ledger.

7. **Sequencing is Assay-first, phased.** Design the seam and the provenance layer
   together (this spec); build the contract first, provenance second, cache and
   double-run third.

## Architecture

```
CLI / MCP / web
  │
  ▼  ┌─ Receipts machinery ──────────────────────────────┐
     │ plan resolution → browser fan → provenance layer  │
     │   · classify stability (kind default → override)  │
     │   · resolve pin: permalink | snapshot | hash      │
     │   · snapshot store + proposal cache (committed)   │
     └───────────────────────┬───────────────────────────┘
                             ▼  PinnedCorpus
     ┌─ src/assay/ ── the extracted contract ────────────┐
     │ chunk → select → propose (cached, ×runs) →        │
     │ admit (threshold-gated) → assemble                │
     │            ▼                                       │
     │ AssayResult = Ledger | Refusal                    │
     └───────────────────────┬───────────────────────────┘
                             ▼
     ┌─ Receipts machinery ──────────────────────────────┐
     │ render (terminal / site) · drift report           │
     └───────────────────────────────────────────────────┘
```

**The load-bearing rule: the Assay never sees a URL it has to trust.** The
machinery resolves every document to a pin *before* calling `assay()`. The Assay
treats `content` as ground truth, as it does today, and stamps each output row with
the provenance of its backing documents. It has no opinion about how a pin was
obtained — GIN_14 §3 source-agnosticism made literal.

### What moves into `src/assay/`

`chunk/`, `retrieve/` (idf, select), `cartographer/propose.ts`, `bookkeeper/`
(admit, anchor, independence), and a new `assemble.ts` that takes over the core of
`report/build.ts`.

### What stays as Receipts machinery

`fetch/` (the browser fan), `sources/` (plan authoring, regulator table),
`report/render/`, `cli|mcp|web/`, and a new `src/provenance/`.

## Components

### `src/assay/types.ts`

```ts
type Pin =
  | { kind: "permalink"; url: string }
  | { kind: "snapshot";  sha256: string }
  | { kind: "hash";      sha256: string }

type Stability = "stable" | "volatile"

interface PinnedDoc {
  id: string
  content: string
  role: SourceRole            // "claimant" | "independent"
  kind: SourceKind
  label: string
  stability: Stability
  pin: Pin
  sha256: string              // raw content, for citation integrity
  driftHash: string           // normalized content, for change detection
}

interface PinnedCorpus {
  subject: string
  docs: PinnedDoc[]
  labels?: RoleLabels
}

interface AssayQuery { subject: string }

interface AssayOptions {
  threshold: number                          // caller-set confidence floor
  conflictMode: "report" | "converge"        // default "report"
  proposer: { runs: 1 | 2; client: ProposalClient }
}

type RefusalReason =
  | "CORPUS_INSUFFICIENT"
  | "NO_GROUNDING"
  | "BELOW_THRESHOLD"
  | "CONFLICTING_UNRESOLVABLE"
  | "QUERY_UNGROUNDABLE"

type ProvenanceReason =
  | "volatile-source" | "single-proposer-run" | "pass-failed" | "stability-violated"

interface RowProvenance {
  class: "stable" | "provisional"
  reasons: ProvenanceReason[]
}

type AssayResult =
  | { outcome: "ledger";  rows: LedgerRow[]; audit: Audit; provenance: LedgerProvenance }
  | { outcome: "refusal"; reason: RefusalReason; confidence: number
      nearMiss: AdmittedSpan[]; audit: Audit }
```

`LedgerRow` keeps today's `divergent | corroborated | unverified` status and gains a
`provenance: RowProvenance`. GIN_14's "divergence report" is the sub-case of a
`Ledger` where `rows.some(r => r.status === "divergent")` — Receipts routinely emits
divergent, corroborated and unverified rows in one ledger, so splitting them into
two outcomes would misrepresent the product.

`QUERY_UNGROUNDABLE` is retained for contract fidelity with GIN_14 and documented as
**unused in Receipts**, where the query is derived from the subject.

### `src/assay/index.ts`

`assay(corpus: PinnedCorpus, query: AssayQuery, opts: AssayOptions) → AssayResult`.
Orchestrates chunk → select → propose ×`runs` → admit each set → assemble. Pure
given the corpus and the responses of `opts.proposer.client`.

### `src/assay/bookkeeper/admit.ts`

Gains a `threshold` parameter. The existing `LOW_CONFIDENCE` admission code becomes
"below the caller's threshold". When *zero* proposals clear it, `assemble` converts
that into `Refusal(BELOW_THRESHOLD)` carrying the near-miss spans and their scores.

### `src/assay/assemble.ts`

Two jobs.

**Outcome decision**, in order:

| Condition | Outcome |
|---|---|
| 0 docs, or only one `role` present | `Refusal(CORPUS_INSUFFICIENT)` |
| No proposals anchored anywhere | `Refusal(NO_GROUNDING)` |
| Proposals exist, none clears `threshold` | `Refusal(BELOW_THRESHOLD)` + near-miss |
| Contradictions present and `conflictMode: "converge"` | `Refusal(CONFLICTING_UNRESOLVABLE)` |
| ≥ 1 admitted row | `Ledger` |

The refusal band is exactly zero admitted rows. One admitted row is a `Ledger`.

**Double-run merge.** Key each admitted row as `(topic, sides sorted by docId+start)`.
Comparison is **scoped to proposal passes that succeeded in both runs** — a pass that
errored in one run must not silently demote its rows. Then:

- in all runs → `class: "stable"`
- in some runs → `provisional` + `single-proposer-run`
- from a pass that failed in either run → `provisional` + `pass-failed`
- any side whose doc is `volatile` → downgrade to `provisional` + `volatile-source`
- any side whose doc was downgraded this run → `provisional` + `stability-violated`

**Outcome disagreement between runs does not produce a refusal.** If one run yields
a ledger and another yields `BELOW_THRESHOLD`, the result is the `Ledger` with every
row marked `provisional` and `audit.runDisagreement = true`. Discarding grounded
findings because a second sample was thin would be the averaging failure in another
costume. Structural refusals (`CORPUS_INSUFFICIENT`) are computed before any model
call and cannot disagree.

### `src/provenance/classify.ts`

**Every `SourceKind` defaults to `volatile`.** Stability is *earned*, two ways:

1. an explicit `stability: "stable"` on the plan target, or
2. a **verified** permalink resolution in `pin.ts`, which promotes the document.

The kind-derived default table this spec originally proposed does not survive the
real plans. `vendor_docs` holds Tesla's FY2024 10-K — immutable, filed, addressable
by accession number — *and* Anthropic's "Model overview docs" and Vercel's limits
docs, both continuously edited. `status_page` holds both NHTSA's static landing page
and its recalls API, which gains rows. No kind reliably predicts stability, and a
default that is wrong half the time is worse than no default: it launders an
assumption into a claim the ledger then prints.

Defaulting everything to `volatile` keeps decision 4's layering intact — declaration
overrides the default, the empirical re-fetch check catches misdeclaration — while
removing the one layer that would have manufactured false confidence. It also makes
the failure direction safe: an unclassified stable source is merely under-credited,
whereas an unclassified volatile source would have been over-credited.

### `src/provenance/pin.ts`

`resolvePin(doc) → Pin`. Tries a per-host permalink resolver — SEC accession URL,
Wikipedia `?oldid=`, an existing `web.archive.org` / `archive.today` URL. On success
the pin is `{permalink}` and `stability` is promoted to `stable`.

**Permalink verification is mandatory.** After resolving, fetch the permalink and
compare its content to the live content already held. Divergence beyond the
normalizer's tolerance → do **not** promote; keep `{hash}` and log
`PERMALINK_MISMATCH`. Archive services soft-404 routinely, and an unverified
permalink is a stability claim with nothing behind it.

### `src/provenance/snapshots.ts`

Content-addressed store at `snapshots/<sha256>.json` holding `{url, fetchedAt,
content}`, committed. `put(content) → sha256`, `get(sha256) → content`.

**The store holds bytes for every corpus document.** `pin.kind` is an orthogonal
*stability claim*, not a storage decision. Because the store is content-addressed
and deduplicated, it grows with new or changed content, not with run count.

### `src/provenance/normalize.ts`

Produces `driftHash`. Strips ISO-8601 timestamps, relative times ("2 minutes ago"),
long digit runs, and common nonce/CSRF patterns. **Deliberately conservative** —
over-normalizing hides real edits, which is worse than a false drift flag.

The raw `sha256` never sees the normalizer: character offsets and the exact-substring
guarantee depend on raw bytes.

### `src/provenance/cache.ts`

A `ProposalClient` decorator. Key:

```
sha256(canonicalJSON({
  docs: docs.map(d => [d.id, d.sha256, d.role, d.stability]),
  query, promptVersion, modelId, selectPolicyVersion
}))
```

Hit → replay stored proposals with no API call. Miss → call through, persist to
`cache/proposals/<key>.json`, committed.

`threshold` is **excluded** from the key — proposals are threshold-independent, since
the floor is applied in `admit`. It is recorded in the report manifest instead, and
replay asserts it matches.

Pruning is manual (`cache prune`, retaining anything reachable from a committed
report). Automatic GC would break historical replay.

### `src/provenance/drift.ts`

Re-fetches, compares `driftHash` against the manifest, and produces the drift
report: documents changed, rows added / removed / status-changed, each change joined
to its cause via `LedgerRow.sides[].docId`, and `STABILITY_VIOLATED` entries at the
top.

Also emits **`QUOTE_VANISHED`**: a row whose cited span is no longer an exact
substring of the re-fetched document. The fresh run drops such a row naturally; the
drift report names it, because *a claim we quoted verbatim is no longer on the page*
is the most valuable single thing this tool can say.

### `src/report/render/`

Renderers switch on `AssayResult`. A `Refusal` renders as a titled block — reason,
near-miss spans with scores, audit line — never as an empty ledger. Every `Ledger`
row shows its provenance class. The footer gains:

```
provenance: 18 stable · 8 provisional (6 volatile-source, 2 single-proposer-run)
replay: 4f2a9c1e…
```

A separate small renderer prints the drift report.

## Data flow

### The pin manifest

Every `reports/<subject>.json` embeds what replay needs:

```
provenance: {
  pins: { <docId>: { url, label, role, stability, pin, sha256, driftHash, fetchedAt } },
  replay: { cacheKey, promptVersion, modelId, threshold, conflictMode, proposerRuns },
  replayable: boolean
}
```

### Mode 1 — Fresh run (`cli -- tesla`)

1. Resolve plan.
2. **Pre-fetch guard** — plan declares only one role → `Refusal(CORPUS_INSUFFICIENT)`,
   exit before any browser starts (today's guard, unchanged).
3. `classify` each target.
4. Browser fan → `FetchedDoc[]` + `SourceFailure[]`.
5. **Post-fetch guard** — only one role survived → `Refusal(CORPUS_INSUFFICIENT)`,
   exit before the model call.
6. `resolvePin` per doc; all bytes → `snapshots.put`.
7. Assemble `PinnedCorpus`.
8. `assay(corpus, query, opts)` — proposer calls go through the cache decorator.
9. **Archive pass** (best-effort) — cited volatile docs submitted to an archiver; on
   verified success, pin upgrades `hash → permalink`, `stability → stable`, and the
   affected rows' provenance is re-stamped.
10. Write `reports/<subject>.json`, commit `snapshots/*` and `cache/proposals/*`.
11. Render.

### Mode 2 — Replay (`cli -- tesla --replay`, and CI)

1. Load the report and its manifest.
2. Reconstruct `PinnedCorpus` from `snapshots/<sha256>` for every doc; **verify**
   each content hash against the manifest. Mismatch → hard error.
3. `assay()` with a **cache-only** proposer client. Cache miss → hard error naming
   the missing key.
4. Diff the result against the committed report.
5. Identical → exit 0. Differs → exit 1 with the diff.

No network, no model call, no key.

### Mode 3 — Re-run / drift (`cli -- tesla --refresh`)

1. Load the prior manifest.
2. Resolve plan, `classify`.
3. **Re-fetch** all `volatile` docs plus any `stable`-declared doc whose pin is
   `hash` — the misdeclaration risk. Permalink-pinned stable docs come from the
   store; re-fetching a pinned SEC filing is pointless and can only fail.
4. Per re-fetched doc, compare `driftHash`:
   - unchanged → reuse;
   - changed, `volatile` → new content, logged to the drift report;
   - changed, declared `stable` → **`STABILITY_VIOLATED`**; use the new content,
     downgrade to `volatile` for this ledger, surface prominently.
5. Build a fresh `PinnedCorpus`.
6. `assay()` live; new cache entries keyed by new content hashes. Old entries are
   untouched, so the prior ledger stays replayable from git.
7. Produce the drift report.
8. Write the new report, snapshots, cache; render ledger + drift report.

The prior report is overwritten but recoverable: git history plus never-deleted
content-addressed blobs mean
`git checkout <old> -- reports/tesla-fsd.json && cli --replay` still reproduces it.

## Error handling

**The layering rule: a source failure is data about coverage; a refusal is a verdict
about the corpus; an exception is our outage.** Collapsing any two of these produced
the bug this project already documents — an expired key yielding an empty report at
exit 0, indistinguishable from a clean bill of health.

**Exit codes: `0` = Ledger, `3` = Refusal, `1` = operational error.**

| Situation | Outcome |
|---|---|
| Some sources fail | `Ledger`; `not read` rows preserved. Not a refusal. |
| All sources fail | `Refusal(CORPUS_INSUFFICIENT)` with failures attached, exit 3 |
| All independent sources fail, claimant read | `Refusal(CORPUS_INSUFFICIENT)` |
| All claimant sources fail | `Refusal(CORPUS_INSUFFICIENT)` |
| **Every** proposal pass fails | Thrown error, **exit 1** — our infrastructure, not a finding |
| Some proposal passes fail | Thinner ledger; affected rows `provisional` + `pass-failed` |
| Permalink content ≠ live content | No promotion; `PERMALINK_MISMATCH` logged |
| Archive submission fails | Best-effort; falls back to `hash`; never blocks |
| Declared `stable`, no resolver for host | `stability: stable`, `pin.kind: hash`; renders **"stable (unverified)"**; always re-fetched on `--refresh` |
| Snapshot blob missing on replay | Hard error naming the sha256 and doc; never silently re-fetch |
| Manifest hash mismatch on replay | Hard error — store corruption or tampering |
| Prompt edited without bumping `promptVersion` | Test failure (see Testing) |

**An honest limit worth stating in the README:** the sources most worth pinning are
the hardest to pin. G2 and Reddit block archivers for the same reasons they block
us, so the rows that most need a permalink are the least likely to get one. This is
a real ceiling on the B target and the reason C is the claim.

## Testing

- **Replay equality in CI.** For every committed plan: reconstruct from snapshots,
  run `assay()` cache-only, diff against the committed report, fail on mismatch.
  This is the mechanical enforcement of the B guarantee and the single most valuable
  test in the suite.
- **Prompt-hash guard.** A test hashes the prompt template and compares it to a
  committed constant, failing loudly when the template changes without a
  `promptVersion` bump.
- **Normalizer unit tests.** Timestamps, relative times, digit runs and nonces are
  stripped; prose containing digits and dates is *not*. Both directions asserted —
  the existing `no results` rule is the cautionary precedent for a check measured in
  only one direction.
- **Refusal-path fixtures.** One committed corpus per refusal reason
  (`CORPUS_INSUFFICIENT` via single role, `NO_GROUNDING`, `BELOW_THRESHOLD` via a
  high threshold, `CONFLICTING_UNRESOLVABLE` via `converge`), asserting the outcome,
  the reason code, and the near-miss payload.
- **Double-run merge tests.** Pass-scoped comparison; outcome disagreement yields a
  provisional ledger rather than a refusal; volatile sides downgrade.
- **Drift tests.** A fixture pair (before / after) asserting `STABILITY_VIOLATED`,
  `QUOTE_VANISHED`, and the row-to-cause join.
- **Cache key stability.** Same corpus and prompt → same key; any doc content
  change, role change, or prompt bump → different key.

## Migration

The four committed reports have no manifest, snapshots, or cache — but `fixtures/`
holds the content, including the 385 KB Tesla 10-K that the Sept-6 regeneration
lost.

**Backfill `snapshots/` and the pin manifest from the existing fixtures.** This buys
content integrity and drift detection immediately. The proposal cache cannot be
backfilled — those model responses were not recorded — so backfilled reports carry
`replayable: false` until their next fresh run populates the cache. CI's replay test
skips reports marked `replayable: false` and asserts that the count of such reports
only ever decreases.

`--from-fixture` and `--replay` both stay and are documented as different tools:
the first re-runs the model on a saved corpus (costs money, varies between runs);
the second replays cached proposals (free, identical).

## Phasing

1. **Assay contract.** Extract `src/assay/`, add `query` / `threshold` /
   `conflictMode`, make `Refusal` a first-class outcome, update renderers and exit
   codes. `PinnedCorpus` exists but every pin is trivially `{hash}`. Tests: refusal
   paths, existing suite green.
2. **Provenance.** `classify`, `pin`, `snapshots`, `normalize`, the manifest, the
   backfill, `--refresh` and the drift report. Tests: normalizer, drift, stability
   violation.
3. **Cache and double-run.** `cache.ts`, `--replay`, the double proposer run and
   provenance classes, CI replay equality. Tests: cache key stability, merge
   semantics, replay equality.

Each phase leaves the tool working and the ledgers publishable.

## Out of scope

- Publishing `assay` as a standalone npm package.
- N-run quorum (`runs > 2`) — the type allows it; the implementation ships `1 | 2`.
- Changes to the browser fan, proxy handling, or captcha stance.
- Ruling on the legitimacy of a divergence.
- Backfilling proposal caches for historical runs.

## Self-review

- **Placeholders:** none. Every refusal reason, provenance reason, pin kind, exit
  code and phase is specified.
- **Internal consistency:** three corrections made during design are carried through
  rather than left contradictory — double-run comparison is pass-scoped (not naive
  row-set intersection); outcome disagreement yields a provisional ledger (not the
  "more conservative wins" refusal first sketched); and the kind-derived stability
  table is gone, replaced by volatile-by-default, after checking it against
  `plans/*.json` and finding `vendor_docs` spanning an immutable SEC filing and two
  continuously-edited docs pages. The snapshot store holds *all* documents, so the
  earlier "snapshot only cited docs" deferral is gone; only archive submission
  remains gated on whether a doc is cited.
- **Decision 4 fidelity:** dropping the kind default narrows decision 4 from three
  layers to two (declaration, empirical check). This is a deliberate weakening of a
  locked decision, recorded here rather than silently applied; if a future kind
  proves a reliable predictor it can be reinstated as a default for that kind alone.
- **Scope:** three phases, each independently shippable. Large but coherent; the
  Assay extraction and the pin discipline cannot be sequenced apart because
  `PinnedCorpus` is the Assay's input type.
- **Ambiguity:** "stable" is used in two senses and both are now qualified at every
  use — *source* stability (`Stability`, a property of a document) and *row*
  stability (`RowProvenance.class`, a function of source stability **and** proposer
  agreement). The renderer shows them separately.
