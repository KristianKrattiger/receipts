# Architecture

Receipts is two things in one repository.

**Assay** (`src/assay/`) is the GIN_14 constraint as code: pinned documents and a query in, a grounded ledger or a typed refusal out. It never fetches, never touches a filesystem, and never imports the Anthropic SDK. Files in the folder import only each other, `zod`, `vitest`, or `node:`; `src/assay/isolation.test.ts` walks every `*.ts` file and fails on anything else. Assay is in-repo constraint tooling, not a published package.

**Receipts** is the live-web field instance of that contract. It chooses sources, fetches them (Solari browsers, Reddit JSON, permalinks from the snapshot store), pins bytes, caches model responses, injects a proposer, and renders the result. CLI, MCP, and web all go through `analyzeLive`.

A second field instance, [Claim/Record](https://github.com/KristianKrattiger/claim-record), points the same Assay at two uploaded piles. It shares `src/assay` via the `assay-split` branch; instance prompt and UI stay in that repo. Either caller can invoke `assay(pinned, query, { client, system })` without importing fetch, Solari, snapshots, or `@anthropic-ai/sdk`. Receipts is the only caller in *this* repo that knows those.

```
sources/ ──► fetch/ ──► analyzeLive
                           │
                           ├─ storeCorpus          snapshots/
                           ├─ withProposalCache    cache/proposals/
                           ├─ toPinnedCorpus       provenance/adapt
                           └─ toAssayClient        cartographer/anthropic
                                    │
                                    ▼
                              src/assay
                         chunk → select → propose
                         admit (discourse) → assemble / mergeRuns
                                    │
                                    ▼
                           Ledger | Refusal
                                    │
                    render / --replay / --refresh
```

The load-bearing rule: Assay never sees a URL it has to trust. Pins are resolved before `assay()` is called. Assay may inspect `url` for the aggregator-as-conduit check (`independence.ts`); that is a property of the quote, not a fetch.

## Assay

Entry: `assay(corpus, query, opts)` in `src/assay/index.ts`.

Given a `PinnedCorpus` (every document already has `pin`, `stability`, `driftHash`, and immutable `text`) and a subject:

1. Refuse `CORPUS_INSUFFICIENT` before any model call if the corpus is empty or has only one role.
2. Chunk documents with offsets that round-trip against `doc.text`. Long paragraphs cut at a newline inside the window when one exists (`preferNewline`, the retrieve default).
3. Select a bounded set of lexical candidates from IDF, not embeddings, under the field profile's retrieval policy (`profile.retrieval`): `queryTerms` picks the subject alone or the subject plus the claimant's own words, and `pinEnds` decides whether each document keeps its first and last chunk regardless of score. Receipts' profile is `queryTerms: "subject"`, `pinEnds: false`; Claim/Record's is `queryTerms: "subject+claimant"`, `pinEnds: true`. Admission still tokenizes the subject only.
4. Fan proposer passes: one relational pass per independent document, a claimant-only pass when there are two claimant docs, and one unsupported pass over the whole corpus.
5. `admit` re-derives every quote as an exact substring and denies anything it cannot find. Independent sentences are tagged `holding` / `issue` / `argument` / `unmarked` from the field profile's closed lexicon. Issue and argument never admit (`ISSUE_STATEMENT`). An unmarked span cannot corroborate, contradict, or update when a holding competitor is already in the pile (`HOLDING_COMPETITOR`). Denied proposals stay on the audit.
6. `assemble` builds a `Ledger` or a `Refusal`. Claimant coverage uses the same chunker with `preferNewline: false` (paragraph then 700-char hard splits, not one chunk per hard-wrapped line); omitted previews are capped at 12. Unmarked corroboration with no holding competitor is `context_unverified`, not `corroborated`. `runs: 2` takes a second sample and `mergeRuns` stamps each row `stable` or `provisional`, and recounts coverage, `independentDocsAdmitted`, and `contextUnverified` from the unioned rows.

The model organises. The sources speak. A fabricated quote cannot reach the ledger because offsets are not taken from the model; they are searched out of the bytes that arrived. `standing` is caller-supplied; Assay never writes or infers it.

`ProposalClient` is SDK-free: `propose({ system, user })` returns a proposal batch. The engine owns no prompt; `profile.system` is the prompt, and a field instance passes it in through its `FieldProfile`. Receipts' is the string that used to be the engine's default (exact quotes, claimant/independent, aggregator-as-conduit), moved verbatim to `src/instance/profile.ts`. Changing Receipts' profile -- the prompt or the retrieval policy -- misses Tesla's proposal cache. A missing client throws. Assay has no `console.error` and no `process.env`.

`src/assay/` refuses to run without a `FieldProfile` (prompt, lexicon, retrieval policy). Receipts' is `RECEIPTS` in `src/instance/profile.ts`.

### Admission

| Code | Why it fires |
|---|---|
| `ANCHOR_NOT_FOUND` | Quote is not an exact substring of `doc.text` |
| `DOC_UNKNOWN` | `docId` is not in the corpus |
| `QUOTE_TOO_LONG` | Quote exceeds 40 words |
| `INCOHERENT_QUOTE` | Quote does not stand as a claim (fragment, bare name, line-break stitch) |
| `NOT_QUERY_RELEVANT` | Span fails the IDF relevance floor |
| `LOW_CONFIDENCE` | Score is below the caller's threshold (default 0.5) |
| `DUPLICATE` | Same pair already admitted |
| `SELF_PAIR` | Both sides are the same document |
| `SELF_SOURCED` | "Independent" side cites the claimant's own domain |
| `ISSUE_STATEMENT` | Independent quote is an issue or argument sentence |
| `HOLDING_COMPETITOR` | Independent quote is a non-holding sentence and this or another Record document holds on the claim |

Quotes that occur more than once in a document are admitted and tagged `AMBIGUOUS`.

### Outcomes

A ledger has rows `divergent`, `unverified`, `context_unverified`, or `corroborated`, in that order. Both sides of a divergent row are always present. `context_unverified` is an admitted unmarked corroboration with no holding competitor — labeled, not painted as confirmation.

A refusal is a result, not a crash:

| Reason | Meaning |
|---|---|
| `CORPUS_INSUFFICIENT` | One role, or no documents. Model is not called. |
| `NO_GROUNDING` | Nothing anchored. |
| `BELOW_THRESHOLD` | Spans were found; none cleared the bar. |
| `CONFLICTING_UNRESOLVABLE` | `conflictMode: "converge"` and the sides still disagree. |

Every proposal pass failing is an operational error (thrown), not a refusal: a refusal is a statement about the corpus, and that is a statement about us.

Contract types live in `src/assay/types.ts`. `src/types.ts` re-exports them so Receipts imports need not churn, and keeps fetch/plan/drift types (`FetchedDoc`, `Corpus`, `SourcePlan`, `Egress`, `DriftReport`) plus `Report` — the on-disk alias for a ledger that may omit `outcome`, because chime/claude/vercel predate it.

## Receipts

### Live path

`analyzeLive` is the machinery every live entry point shares:

1. `storeCorpus` commits fetched bytes to `snapshots/` (sha256 of content). Failure here warns and continues with hash pins rather than claiming snapshots that do not exist.
2. `withProposalCache` wraps the parse-shaped Anthropic client. Keys are the canonical JSON of the parse body (`model`, `max_tokens: 16000`, `system`, `messages`, `output_format`). Changing that body is a Tesla cache miss — including retrieve, chunking, or an injected system prompt, which is why the 2026-09-14 restamp wrote sixteen new keys.
3. `toAssayClient` translates `beta.messages.parse` into Assay's `propose({ system, user })`.
4. `analyzeCorpus` lifts `Corpus` → `PinnedCorpus` (`provenance/adapt.ts`) and calls `assay`.
5. If every response is on disk, the result is stamped with `replay`.

CLI, MCP, and web all use this. MCP still returns markdown and web still returns HTML; neither writes a committed `reports/*.json`. An operator who wants a `--replay` file uses the CLI.

### Folders

| Path | Job |
|---|---|
| `src/assay/` | Constraint: chunk, retrieve, propose, admit, discourse, assemble, merge. Isolation-tested. |
| `src/instance/profile.ts` | The field profile, by prompt tier (`frontier`, `small`): prompt, lexicon, retrieval policy; `src/assay/` refuses to run without one. |
| `src/instance/prompt-small.ts` | The small-model system prompt: same rules as frontier, stated first and shorter. |
| `src/instance/calibration/` | Five calibration cases plus a Tesla candidate check. Proves each outcome is reachable and checks Tesla offline. |
| `src/sources/` | `SourcePlan`: URLs and roles. Pure. No network. |
| `src/fetch/` | Browser fan (Solari) and Reddit JSON. The only code that costs money or time on the way in. A blocked source is a `SourceFailure`, never fatal. Text is normalized once; `doc.text` is immutable thereafter. |
| `src/provenance/` | Pins, snapshots, drift hashes, proposal cache, `toPinnedCorpus`. |
| `src/cartographer/anthropic.ts` | SDK client, `MODEL`, workspace header, `toAssayClient`. |
| `src/pipeline.ts` | `analyzeCorpus`: pin, then assay. |
| `src/analyze-live.ts` | Store, cache, stamp. Shared by CLI / MCP / web. |
| `src/report/render/` | Terminal, markdown, HTML, drift. Consume `Report \| Ledger \| Refusal`. Four row statuses, amber `context_unverified`. |
| `src/cli/` | Fetch, `--from-fixture`, `--render`, `--refresh`, `--replay`. |
| `src/mcp/` | `diligence_vendor` over stdio. Must not write to stdout except JSON-RPC. |
| `src/web/` | HTTP form, rate limit, static site build. |

`src/report/build.ts` is a Receipts leftover: a one-line `buildReport` over `assemble`. Assay does not import it.

### Pins

A document's pin is how its bytes can be got again. Precedence is `permalink` > `snapshot` > `hash`.

- `permalink` — URL permanent by construction: an SEC EDGAR accession path, or a Wikipedia `oldid`. Not inferred from `SourceKind`.
- `snapshot` — this run committed the bytes to `snapshots/`. Replayable, not stable. A committed blob says nothing about whether the source will serve the same bytes tomorrow.
- `hash` — enough to detect drift, not enough to replay.

Stability (`stable` | `volatile`) is a separate fact, declared on the plan or earned by a permalink, never assumed from kind. Tesla's committed ledger is two proposer samples; every row is still `provisional` because the cited pages are volatile.

### Replay and refresh

`--replay` rebuilds a saved report from committed snapshots plus the proposal cache. No network, no model, no key. It also refuses a report with no field profile recorded, or one stamped under another profile, and asks the cache for the manifest's `model` rather than a constant. `npm run replay` is `1 replayed, 3 not replayable`: Tesla's 2026-09-17 restamp (`16` cached responses from `qwen2.5:7b` via `--client ollama`) replays; chime, claude, and vercel have no `replay` block — see the [README](README.md).

`--refresh` re-fetches a report's sources and reports drift. It does not write `stabilityViolated` into Assay. `--refresh --rerun` is a paid live analysis.

## Surfaces

```
CLI  ─┐
MCP  ─┼─ fetchCorpus ─► analyzeLive ─► render
web  ─┘
         --from-fixture skips fetch, still goes through analyzeLive
         --replay skips both; reads snapshots/ + cache/proposals/
         --refresh re-fetches; optional --rerun analyses the new corpus
```

Exit codes: `0` ledger, `3` refusal, `1` operational error. `--fetch-only` never reaches the assay: `0` if anything was read, `2` if nothing was.

## What this is not

- Not a published npm package, not a `packages/assay` workspace.
- Not a database. Bytes live in git (`snapshots/`, `cache/proposals/`, `reports/`).
- Not embeddings, not constrained decoding. Lexical retrieval in, exact-substring verification out.
- MCP and web do not persist `reports/*.json`.

Design history: [`docs/superpowers/specs/2026-08-31-receipts-design.md`](docs/superpowers/specs/2026-08-31-receipts-design.md) (original downhill pipeline), [`docs/superpowers/specs/2026-09-09-assay-reproducible-ledgers-design.md`](docs/superpowers/specs/2026-09-09-assay-reproducible-ledgers-design.md) (the contract), [`docs/superpowers/specs/2026-09-12-assay-constraint-seam-design.md`](docs/superpowers/specs/2026-09-12-assay-constraint-seam-design.md) (this seam). What a ledger looks like, and why, is in the [README](README.md).
