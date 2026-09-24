# Tighten `holdingCompetesWithClaim`, plus two Claim/Record hardening fixes

**Date:** 2026-09-24
**Status:** approved design
**Repos:** `receipts` (engine + `admit.test.ts`) and `claim-record` (engine copy + its own new regression fixture, plus two unrelated app-level fixes).

## Why

The 2026-09-14 review flagged `holdingCompetesWithClaim`'s two-token-overlap branch as over-broad. Investigating it turned up a worse problem: the *IDF-relevance* branch alone (`idfRelevance(holding, claimTerms, idf) >= 0.13`) produces a false positive independent of overlap. An unrelated Blue Chip standing holding ("a private right of action ... extends only to actual purchasers or sellers ... standing does not extend to those who merely relied") scores 0.32 relevance against a negligent-bookkeeping claim quote — high enough to block a legitimate unmarked statute-contradiction row as `HOLDING_COMPETITOR`, even though the two sentences share no real subject.

The originally chosen fix (IDF-relevance AND overlap, plus a corpus-frequency stoplist on both) does not work: Blue Chip's filtered relevance (0.19) still clears the 0.13 floor, and the same stoplist drops two genuine true positives below the floor (Central Bank 0.13→0.06, Tellabs 0.12→0.00). The root cause is structural, not a threshold problem: Blue Chip's raw relevance against the claim alone (0.32) is *higher* than two real true positives (0.13, 0.12). No threshold on "holding vs. claim alone" can separate them, filtered or not.

Three scripted signals were tried against every real `HOLDING_COMPETITOR` scenario in both repos' test suites (6 must-compete, 2 must-not-compete, spanning same-doc/cross-doc paths and all three relevant relation types) plus the Blue Chip case:

1. IDF-relevance + stoplist-filtered overlap — fails (above).
2. Raw IDF-weighted token overlap between claim and holding (no stoplist) — fails: Blue Chip scores 1.40, higher than 2 of 3 true positives (0.38, 0.88).
3. **IDF-weighted overlap between the holding and the vocabulary the claim quote and the unmarked span jointly share** — clean separation: must-compete weights `[0.267, 0.401, 0.365, 0.401]`, must-not weights `[0, 0.134]`.

Signal 3 works because it asks a different question than signals 1 and 2. The old signal asked "does this holding talk about what the claim talks about" — too broad, since a claim and an unrelated holding can share incidental vocabulary (Section 10(b), private right of action). The new signal asks "does this holding talk about what the claim *and the specific sentence being checked* are jointly disputing" — narrower by construction, because it requires the overlap vocabulary to be common to two independently-worded spans, not just present in one.

## Decision

Replace `holdingCompetesWithClaim`'s signature and implementation. Delete `distinctiveOverlap` and the IDF-relevance-OR-overlap branching entirely — one function, one signal.

```ts
const HOLDING_COMPETITOR_FLOOR = 0.2

function distinctive(text: string): Set<string> {
  const stop = new Set([
    "that", "with", "from", "this", "they", "them", "than", "then", "when", "what",
    "have", "been", "were", "will", "shall", "into", "upon", "also", "such", "only",
    "more", "some", "over", "under", "even", "must", "does",
  ])
  return new Set(tokenize(text).filter((t) => t.length >= 4 && !stop.has(t)))
}

/**
 * A holding competes with a claim when it shares IDF-weighted vocabulary with
 * what the claim quote and the disputed sentence are jointly about — not with
 * the claim alone, which an unrelated holding can resemble by incidental
 * subject overlap (two Section 10(b) sentences that concern different
 * questions). Requiring the shared vocabulary to be common to *both* the
 * claim and the sentence under test narrows the match to the sentence's
 * actual subject.
 */
function holdingCompetesWithClaim(
  holding: string,
  claimQuote: string,
  unmarkedSpan: string,
  idf: Map<string, number>,
): boolean {
  const claimVocab = distinctive(claimQuote)
  const jointVocab = [...distinctive(unmarkedSpan)].filter((t) => claimVocab.has(t))
  const holdingVocab = distinctive(holding)
  let weight = 0
  for (const t of jointVocab) if (holdingVocab.has(t)) weight += idf.get(t) ?? Math.log(2)
  return weight >= HOLDING_COMPETITOR_FLOOR
}
```

`HOLDING_COMPETITOR_FLOOR` sits at 0.2, comfortably inside the gap between the observed must-compete minimum (0.267) and must-not-compete maximum (0.134).

## Engine changes (`src/assay/bookkeeper/admit.ts`)

- Delete `distinctiveOverlap` (lines 62–73) and the old `holdingCompetesWithClaim` (lines 75–88); replace with `distinctive` and the new `holdingCompetesWithClaim` above.
- `blocksNonHolding`'s two call sites both simplify to pass `envelope.text` (already computed at the top of the function) as the unmarked span, replacing the now-unneeded `sameDocTerms`/`fromTerms` locals:
  - Same-doc loop: `holdingCompetesWithClaim(sentence.text, fromSpan.text, envelope.text, idf)`, deleting the `sameDocTerms` line.
  - Cross-doc loop: `holdingCompetesWithClaim(sentence.text, fromSpan.text, envelope.text, idf)`, deleting the `fromTerms` line.
- `DIVERGENCE_IDF_FLOOR` and `idfRelevance` remain imported and used elsewhere in the file (`offTopic` check); only their use inside `holdingCompetesWithClaim` goes away.

No signature or behavior change to `blocksNonHolding` itself, `admit()`, or anything downstream — this is a pure swap of the internal competition test.

## What does not change

- `assemble.ts`, `merge.ts`, the discourse lexicon, retrieval, replay, every field profile — none of them reference `holdingCompetesWithClaim` or `distinctiveOverlap` directly.
- Determinism: the new signal is a pure function of `corpus.docs`/`idf`, same inputs as before.
- The 6 existing `HOLDING_COMPETITOR` scenarios in `receipts/src/assay/bookkeeper/admit.test.ts` and Claim/Record's `calibration.test.ts` — all validated to keep passing (see Why).

## Testing

- `receipts/src/assay/bookkeeper/admit.test.ts`: the existing 6 `HOLDING_COMPETITOR` cases (lines ~752, 786, 826, 873, 895, 922) must keep passing unchanged — no new fixtures needed there, since the false positive never reproduced in receipts' own domain corpus.
- `claim-record/src/instance/calibration/calibration.test.ts`: add one new regression test reproducing the Blue Chip false positive — an unrelated `pin("blue_chip", "independent", "We hold that a private right of action under Section 10(b) extends only to actual purchasers or sellers of securities, and standing does not extend to those who merely relied on a misrepresentation without transacting.")` in the pile alongside `STATUTE`, proposing an unmarked `STATUTE`-vs-claim contradiction; assert it is admitted (not denied `HOLDING_COMPETITOR`).
- `npm run typecheck`, `npx vitest run` clean in both repos after the engine copy; `diff -rq receipts/src/assay claim-record/src/assay` empty.
- No replay regeneration needed: `reports/tesla-fsd.json`'s cached proposals contain no `HOLDING_COMPETITOR` denials whose admission status this change flips (confirm via `npm run replay` reporting the same `1 replayed, 3 not replayable` as before — a genuine check, not an assumption, since this change touches denial logic that replay re-runs).

## 2. Escape Claim/Record's unescaped `innerHTML` sinks (`src/web/index.html`)

Six template-literal interpolations write untrusted or semi-trusted server-response fields directly into `innerHTML` (lines ~150–178): `data.error`, `r.detail`, `doc.label`, `s.text`, `row.statement`, `p.text`. A crafted document label, quote, or narrative paragraph reaching the server (e.g., via an uploaded document) could inject markup or script into the audit page.

**Fix:** import the existing `escapeHtml` export from `./audit.js` (already used internally there) into `index.html`'s module script, and wrap each of the 6 sinks. Leave `role`, `row.status`, and `row.provenance.class` unwrapped — these are engine-controlled enum values (`"claimant" | "independent"`, `AdmissionCode`-adjacent status strings, provenance class), never free text from a document.

No test harness exists for this static HTML/JS file today, and building one (jsdom, a DOM test runner) is out of scope for what is otherwise a 6-line escaping fix — verified by manually loading the page and confirming rendering is unchanged for normal input.

## 3. Empty-subject guard test coverage (Claim/Record)

`runClaimRecord` (`src/instance/run.ts:39-40`) already throws `UploadError("subject is required")` on an empty/whitespace subject, and the server (`src/server/index.ts:30-75`) already maps `UploadError` to HTTP 400. Neither path has a test. Confirmed `anthropicClient()` construction does not throw synchronously without `ANTHROPIC_API_KEY` set (`new Anthropic(...)` validates lazily, at call time) — the subject guard fires before any client method is called, so no client stub or key handling is needed for either test.

Two tests, following each file's existing pattern exactly:

- `src/instance/run.test.ts`: a unit test asserting `runClaimRecord({ subject: "", claim: [], record: [], client: <existing stub> })` rejects with `UploadError`.
- `src/server/index.test.ts`: an integration test using the file's existing `createApp()` / `listen(0, "127.0.0.1", ...)` / `fetch()` pattern, POSTing `{ subject: "" }` to `/assay` and asserting a 400 response with an `error` body.

## Out of scope

- Restructuring `blocksNonHolding`'s call sites beyond the `holdingCompetesWithClaim` signature change.
- A jsdom/DOM test harness for `claim-record/src/web/index.html`.
- Any other unescaped-output audit of Claim/Record's web UI beyond the 6 named sinks (no others were found, but this spec doesn't claim an exhaustive security review).
- The `assay-split` branch and `claim-record/src/instance/ollama.ts` items from the original 5-item list — already complete, pushed on their respective repos.
