# Receipts — Design Spec

**Date:** 2026-08-31
**Status:** approved

## Summary

Receipts is a vendor due-diligence tool. Given a product name, it fans a set of cloud browsers across the vendor's own marketing and the places users actually complain, then produces a **claim ledger**: what the vendor asserts, what independent sources report, and — crucially — which claims nothing corroborates.

Every quote in the output is verified to be an exact substring of bytes we fetched ourselves. An LLM proposes the pairings; a deterministic gate admits them. The model cannot fabricate a quote, because the gate re-derives every span from the source text.

## Motivation

AI research tools blend contradicting sources into one confident paragraph. The market complaint is real and unaddressed: buyers evaluating a tool want to know where the vendor's story and users' reports diverge, not a smoothed average of both.

The sources that matter here — G2, Trustpilot, Reddit, status page histories — block datacenter traffic. Stealth browsers with residential proxy egress are not decoration; they are the reason the tool can read its inputs at all.

### Lineage

The epistemic design is ported from GIN (`C:/Users/krist/Projects/gin/GIN`), a federated grounded-reasoning system. Three ideas carry over:

1. **Productive divergence** — when sources disagree, surface the disagreement rather than averaging it. GIN's `retrieve_for_synthesis()` classifies a bundle divergent vs convergent; divergent mode forces citation of both sides of a `contradicts` edge via `required_doc_groups`.
2. **Exact attribution by construction** — SEAR constrains generation to spans occurring verbatim in the corpus, each carrying `(doc_id, start, end)`, and tags spans `EXACT` or `AMBIGUOUS`.
3. **Layer separation** — Cartographer proposes edges, Bookkeeper alone admits and persists them, Reasoning is read-only. No layer can inflate its own record.

What is deliberately **not** ported: the Postgres/pgvector corpus tier, MiniLM embeddings, the local GGUF decode path, and the learned frame detector. GIN's own measurements record `issue_frame_recall` of 0.00 for the frozen-embedding detector, with the finding that the geometry separates topical distinctions and fails on epistemic ones. Vendor-claim-vs-user-report divergence is the epistemic class, so that layer is not something to build on.

SEAR's constrained decoding is replaced by **post-hoc exact-substring verification**, which achieves the same guarantee for this use case with no model and no infrastructure.

## Scope

**In scope:** browser fan-out, chunking with stable offsets, lexical retrieval pre-filter, LLM relation proposal, deterministic admission gate, claim ledger report, CLI, MCP server, hosted demo page.

**Out of scope:** persistence/database, user accounts, scheduled re-runs, multiple vendor verticals with bespoke schemas, sandboxes and desktops. The brief permits "browsers, sandboxes, and/or desktops"; every honest use here is a browser use, and adding another primitive for its own sake would be decoration.

## Architecture

Seven core modules in a strict downhill dependency chain, plus three surfaces. Nothing imports upward. `bookkeeper/` never imports `cartographer/`'s client; it receives proposals as plain data.

```
sources/ -> fetch/ -> chunk/ -> retrieve/ -> cartographer/ -> bookkeeper/ -> report/
            [Solari]                        [Claude]          [pure]         [pure]
                                                                                |
                                                            cli/ · mcp/ · web/
```

### Modules

**`sources/`** — `buildSourcePlan(subject, overrides)` returns `SourceTarget[]`, each tagged `role: "vendor_claim" | "independent"`. Known URL patterns (statuspage conventions, HN Algolia search, Reddit search, docs and pricing paths) plus manual override. Pure, no network.

**`fetch/`** — The browser fan, and the only module that touches Solari. Bounded-concurrency `launch({ stealth: true, proxy: "us" })`. Returns `FetchedDoc[]` plus `SourceFailure[]`. A blocked source is isolated and recorded, never fatal. Text is normalized exactly once here; `doc.text` is immutable thereafter and is the sole substrate for anchor verification.

**`chunk/`** — Splits docs into chunks with stable offsets so a span can carry `(docId, start, end)`.

**`retrieve/`** — Lexical relevance over the fetched corpus. Provides both the LLM cost pre-filter (send candidate chunks, not whole documents) and the IDF relevance gate the Bookkeeper needs. Mirrors GIN's seed-then-expand shape.

**`cartographer/`** — Proposes typed relations (`contradicts`, `corroborates`, `updates`, `unsupported`) across sources. Each proposal carries a verbatim quote and a `docId`. It may not assert offsets and never writes the report.

**`bookkeeper/`** — Sole writer of the `Report`. Admission checks:

| Check | Denial code |
|---|---|
| Quote is an exact substring of `doc.text` | `ANCHOR_NOT_FOUND` |
| `docId` exists in the corpus | `DOC_UNKNOWN` |
| Quote is at most 40 words | `QUOTE_TOO_LONG` |
| Both sides IDF-relevant to the subject | `NOT_QUERY_RELEVANT` |
| Confidence clears floor (0.5) | `LOW_CONFIDENCE` |
| Not a repeat of an admitted pair | `DUPLICATE` |
| Sides are different documents | `SELF_PAIR` |

Quotes occurring more than once in a document are admitted and tagged `AMBIGUOUS` rather than resolved arbitrarily. Denied proposals are retained and reported.

**`report/`** — Canonical `Report` JSON plus terminal, markdown, and HTML renderers over it.

### Ledger row statuses

| Status | Meaning | GIN lineage |
|---|---|---|
| `divergent` | Vendor claim contradicted by an independent source. Both sides always rendered together. | divergent mode + `required_doc_groups` |
| `corroborated` | Vendor claim independently confirmed. | convergent mode |
| `unverified` | Vendor claim with no independent source either way. | zero cursors — grounding failure as a first-class signal |

`unverified` is the differentiating output. Every summarizer silently drops claims it cannot check; GIN treats "the corpus cannot support this continuation" as a result. Reported as: *"9 of 23 vendor claims have no independent corroboration in any source we could read."* Not false — unsupported, and named.

## Invariants

1. **No quote in any report is absent from the bytes we fetched.** Machine-checked over every fixture.
2. Normalization happens once, at the fetch boundary. Cartographer and Bookkeeper see byte-identical text.
3. The model's paraphrase is used only as a row label for grouping; it is never rendered as an assertion. Only verbatim quotes are asserted.
4. Partial coverage is valid output. A run reading 4 of 7 sources reports that.
5. Zero admitted rows is a valid report.

## Error handling

- Per-source isolation: each target resolves to a `FetchedDoc` or a typed `SourceFailure` (`timeout | blocked | captcha | empty | http_error`).
- Empty extraction is a failure, not an empty doc — a zero-length `text` would fail every anchor against it and make the gate look broken.
- Solari lifecycle: `await solari.close()` in a `finally` or the process hangs; `browser.close()` releases the session; `timeoutMs` is a rolling idle window. Confined to `fetch/`.
- Malformed LLM output: one repair retry, then fail with the raw response preserved. A proposal citing an unknown `docId` is denied, never a crash.
- `stop_reason: "refusal"` is checked before reading content.

## Testing

The bookkeeper carries adversarial tests: paraphrased quotes, single-word alterations, whitespace variants, quotes stitched across documents, and over-length quotes must all be denied; genuinely repeated quotes must be admitted as `AMBIGUOUS`.

The cartographer is nondeterministic and is not golden-tested. The invariant is tested property-style instead: over arbitrary proposals, half fabricated, the gate must never admit a span absent from `doc.text`.

`fetch/` is the only module that costs money or time. Everything downstream is a pure function of `FetchedDoc[]`, so fixtures captured once support days of offline, instant, zero-credit iteration. One live end-to-end smoke runs behind an env var so CI never burns credits.

## Run economics

| Component | Estimate |
|---|---|
| 6 browsers × ~30s, concurrent | ~3 browser-minutes, ~$0.005 |
| Residential proxy egress, ~30 MB | ~$0.03 |
| Claude Opus 5, retrieval-filtered (~8k in / ~4k out) | ~$0.14 |
| **Total** | **~$0.18 per run** |

Without the `retrieve/` pre-filter the LLM leg is ~$0.34 alone, which is why the pre-filter is in scope rather than an optimization.

Free tier caps at 3 concurrent browsers, so a 6-source fan runs as two waves. Concurrency is configuration, defaulting to 3, so it scales to 20 on Starter without a code change.

The hosted demo therefore leads with pre-baked reports and rate-limits live runs; sustained usage moves to the CLI and MCP server where users bring their own key.

## Legal posture

Admitted spans are capped at 40 words and always carry a link back to the source. The cap is enforced in the gate, not in a prompt, so it cannot be argued around. Official free APIs are preferred where they exist (HN Algolia, Reddit); the browser fan is reserved for sources that genuinely require it.

## Deliverables

1. `receipts/` — TypeScript workspace: engine, CLI, MCP server, web.
2. Committed fixtures for two or three real vendors.
3. Hosted demo with pre-baked reports and a rate-limited live run.
4. README, demo recording, and the launch post.
