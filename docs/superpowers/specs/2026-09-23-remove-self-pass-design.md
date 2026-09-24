# Remove the claimant-only ("self") proposer pass

**Date:** 2026-09-23
**Status:** approved design
**Repos:** `receipts` (engine + the committed Tesla ledger) and `claim-record` (engine only; no committed report exists there).

## Why

The 2026-09-23 side-role-invariant change made `admit()` require a relation's `from` side to be claimant and its `to` side, when present, to be independent. `planPasses` (`src/assay/cartographer/propose.ts`) still plans a dedicated `"self"` pass whenever a corpus has two or more claimant documents, with `candidates` drawn *only* from claimant documents and `mode: "relational"`.

Every proposal that pass can produce has both `from` and `to` drawn from its all-claimant candidate pool. Under the new invariant, every such proposal is denied — `SELF_PAIR` if the model happens to pick the same document twice, `TO_NOT_INDEPENDENT` otherwise. There is no proposal this pass could return that `admit()` would ever accept. It is not a pass that got weaker; it is a pass whose entire candidate pool now guarantees denial, unconditionally, for any proposer that stays within its own candidates.

This was flagged in the side-role-invariant final review as a stale rationale (fixed) left behind by a spec that only looked at `admit.ts`. The comment now says plainly that the pass costs a paid model call for no possible admitted row, and that removing it was deferred as a separate decision. This spec is that decision: remove it.

## Decision

`planPasses` stops emitting the `"self"` pass. The `claimantDocCount >= 2` branch is deleted. Everything else about pass planning — one pass per independent document, the whole-corpus `unsupported` pass, the empty-corpus fallback — is unchanged.

## Engine changes (`src/assay/`)

**`cartographer/propose.ts`.** Delete the `self` pass block:
```ts
  // Self-contradiction needs at least two claimant documents to be possible.
  const claimantDocCount = new Set(claimant.map((c) => c.docId)).size
  if (claimantDocCount >= 2) {
    passes.push({ passId: "self", mode: "relational", candidates: claimant })
  }
```
The `ProposalPass` doc comment's paragraph about the self pass (the one the side-role-invariant branch just rewrote to say it's wasteful) is deleted along with the pass — there is nothing left to explain once it doesn't exist. The surrounding paragraphs about why relational and unsupported passes are split stay untouched.

**Tests.** `propose.test.ts`'s four self-pass-specific tests and assertions (the pass-list including `"self"`, the pass's candidate set, the omission case, the relational-mode-includes-`"self"` list) are removed or rewritten to describe a `passes` list without it. The "omits the self pass when only one claimant document was read" test becomes meaningless (there's no self pass to omit under any claimant count) and is deleted rather than kept as a trivial no-op.

## What does not change

- `admit()`, `assemble.ts`, `types.ts`, retrieval, the lexicon, the field profile — none of them plan passes; this is purely `planPasses`.
- Determinism: `planPasses` stays a pure function of `docs`/`candidates`. Removing a branch doesn't change purity.
- Claim/Record: same engine, no committed report, nothing else to change.

## The committed Tesla ledger must be regenerated — free, no plan gate needed

Tesla has 3 claimant documents, so the self pass currently runs (`passId: "self"`, 8 total passes including it, ×2 samples = 16 cache keys, 4 of them — `self:p0` through `self:p3` — used only by that pass). Once `planPasses` stops emitting it, replaying the corpus re-plans 7 passes instead of 8; the `self:p*` keys are never requested. This is regenerated the same way as every prior admit.ts-driven change: reconstruct the corpus, re-run `admit()`/`assemble()` against the cache, no new model call.

Cache keys are plain SHA256 hashes of the request body (`cacheKeyFor`, `src/provenance/proposal-cache.ts`) — nothing in a key's string names the pass that produced it, so which two of the sixteen belonged to the self pass is not recoverable from the manifest alone without re-deriving every request. This regeneration follows the exact pattern of the two prior ones: replace only `rows` and `audit` from `runReplay`'s reproduction; leave `replay.keys`, every `replay.samples[].keys`, `generatedAt`, `docs`, `failures`, `subject`, and `labels` exactly as committed. `saved.replay.keys` is descriptive, not load-bearing — `runReplay` drives what it requests from `planPasses`'s live output, not from the stored key list, so a stale list does not affect whether replay succeeds or what `npm run cli -- tesla --replay` reports (that count comes from the live run, always accurate). The two now-unused keys join the ledger's existing orphaned-key precedent: README already reports the 2026-09-12 and 2026-09-14 keys (thirty-two Opus responses) as "remain on disk and no longer replay" by count alone, with no hash-level detail; the two self-pass keys are documented the same way, not hunted down individually.

Every place the count "sixteen" or "8 passes" narrates this specific ledger needs updating to fourteen / 7 passes: `README.md` (the cost-section paragraph, the restamp paragraph, the replay-mechanism paragraph, the cache-directory paragraph, the `<details>` audit line) and `architecture.md`'s cache-key paragraph. Count references to *other* ledgers or to unrelated sixteen-attempt measurements (the DataDome captcha paragraph) are untouched — check each hit by reading its sentence, not by search-and-replace.

## Testing

- `src/assay/cartographer/propose.test.ts`: `planPasses` over a corpus with 2+ claimant documents returns exactly the per-independent-document passes plus `unsupported`, no `"self"` entry, regardless of claimant count (1, 2, or more — one assertion covering what used to be two different cases).
- `npm run typecheck`, `npx vitest run` clean in both repos; `diff -rq receipts/src/assay claim-record/src/assay` empty.
- `src/cli/replay.test.ts`'s Tesla-ledger test: `"replay: identical (14 responses from cache)"`.
- `npm run replay` on `main`, after regeneration: `1 replayed, 3 not replayable`.

## Out of scope

- Any change to the `unsupported` pass or the per-independent-document passes.
- Any prompt change in either repo (this is pass-planning, not prompt content).
- A general audit of `planPasses` for other passes that could similarly never yield an admitted row — none exist; this is the only one the side-role invariant made permanently unproductive.
