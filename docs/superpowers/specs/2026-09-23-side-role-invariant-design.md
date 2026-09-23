# Side-role invariant: `from` is claimant, `to` is independent

**Date:** 2026-09-23
**Status:** approved design
**Repos:** `receipts` (engine + the committed ledger this touches) and `claim-record` (engine only; no committed report exists there).

## Why

The 2026-09-23 rule-4 fix-verification run (`qwen2.5:14b`, small tier, `fixtures/tesla-fsd.json`, `--runs 2`) admitted a row pairing two *independent* documents against each other — Hacker News' crashes thread against its robotaxi thread, no claimant side at all — labeled `context_unverified` with the vague statement "Tesla's Robotaxi program, also known as Cybercab, is facing challenges...". Nothing in `src/assay/bookkeeper/admit.ts` checks that `from` references a claimant document; every prompt tier, in both repos, has always said so as a convention, never as an engine invariant. The gap has existed since the project's first commit and was only ever unexercised because frontier-tier Opus happened to comply.

While designing the fix, `admit.ts`'s `sides` field carried a second, older, and deliberate decision: `sides` is not split into role-keyed slots specifically so that a claimant-vs-claimant pairing — "a vendor's pricing page contradicting its own docs" — can be admitted and rendered. That decision produced exactly one row across every ledger this project has stamped (`reports/tesla-fsd.json`'s "All Tesla vehicles manufactured after 2014 are equipped with..." row, admitted under the Receipts frontier prompt on `qwen2.5:7b`), flagged at the time as "worth being suspicious of," and the small-tier prompt's own attempt at the same pairing (twice, on two different fix iterations) produced nothing but noise: repeated same-document self-contradiction hallucinations and vague one-two-word "conflicts" that were not conflicts.

Both questions were put to the project owner directly, informed by the documented rationale on both sides. Decision: forbid both. `from` must reference a claimant document; `to`, when not null, must reference an independent one. This is a deliberate reversal of the `sides`-array rationale, not an oversight — the spec says so, and the comment that justified the old behavior is rewritten, not left stale.

## Decision

Two new checks in `admit()`, one shared engine, both repos:

1. **`FROM_NOT_CLAIMANT`** — `from`'s document must have `role === "claimant"`.
2. **`TO_NOT_INDEPENDENT`** — when `to` is present, its document must have `role === "independent"`.

Two codes, not one combined (unlike `DOC_UNKNOWN`, which already covers both sides): they diagnose different failures. A `FROM_NOT_CLAIMANT` spike says the proposer picked the wrong claim source entirely. A `TO_NOT_INDEPENDENT` spike says it is still reaching for the retired self-contradiction pairing.

## Engine changes (`src/assay/`)

**`bookkeeper/admit.ts`.** In the per-proposal loop:

- Right after `fromDoc` resolves (before `findAnchor` runs on the `from` side): if `fromDoc.role !== "claimant"`, deny `FROM_NOT_CLAIMANT` with the `from.docId` as detail, in the same shape as the existing `DOC_UNKNOWN` push. No anchor search is attempted — the document is wrong regardless of what the quote says.
- Right after the existing `SELF_PAIR` check (same `docId`) and before `findAnchor` on the `to` side: if `toDoc.role !== "independent"`, deny `TO_NOT_INDEPENDENT` with the `to.docId` as detail. Ordering after `SELF_PAIR` is deliberate: a same-document pair still reports the more specific, pre-existing code; this check only fires for two *different* documents that share a role.

**`sides`' doc comment.** Rewritten. It currently justifies the array shape (not role-keyed slots) by naming claimant-vs-claimant self-contradiction as a valued case. Once both checks exist, `sides` is always `[claimant-side, independent-side]` in that order for a two-sided relation — the comment must say that, and say plainly that the array shape is kept anyway, not restructured into named slots, because nothing downstream (renderers, report types, calibration fixtures, in either repo) gains anything from the rename that the fixed order doesn't already give it for free. Restructuring `sides` into role-keyed fields is explicitly out of scope: a real refactor with a real blast radius, for a guarantee this change makes true without it.

**`types.ts`.** `AdmissionCode` gains `"FROM_NOT_CLAIMANT"` and `"TO_NOT_INDEPENDENT"`. `NOT_ANCHORING_EVIDENCE` (in `assemble.ts`) gains both — same semantic as `DOC_UNKNOWN`: no span was ever located for that side, so the denial doesn't count as anchored evidence that then failed on some other ground.

## What does not change

- `assemble.ts`, `merge.ts`, the discourse lexicon, retrieval, the field profile — none of them touch role identity; this is purely an `admit()`-level structural check, independent of which `FieldProfile` is in force.
- Determinism: the check is a pure function of `corpus.docs` and the proposal, applied post-model, same as every other `admit()` check. The `assay()`-twice-strictly-equal test is unaffected.
- Claim/Record: same engine, same behavior, no committed report to regenerate. Its own prompt has never described a claimant-vs-claimant case either, so nothing in its prompt needs to change.

## The committed Tesla ledger must be regenerated — free, no plan gate needed

`reports/tesla-fsd.json` on `main` has exactly one claimant-vs-claimant row (the one named above). `npm run replay` reconstructs the corpus from the report's pins plus `snapshots/` and re-runs `admit()` against the 16 already-cached proposal responses — no new model call, no cost. Once these checks exist, that replay produces a diff (the row drops out), not an identity match, and CI's replay step would fail on the next push.

The fix: after the engine change lands, reconstruct the corpus the same way `runReplay` does, re-admit the same cached responses under the new engine, and write the result back as the new `reports/tesla-fsd.json` — same technique used for the 2026-09-14 and 2026-09-17 restamps-from-cache. This is a plan task, not a separate paid-restamp-style owner gate: nothing costs money, nothing calls Ollama or Anthropic, and the row being removed is the one already flagged as questionable. `npm run replay` must report `1 replayed, 3 not replayable` afterward, identical to itself.

**README.md**'s "One row to be suspicious of" paragraph (currently framing this as an open question) is rewritten to say what happened: the row was a claimant-vs-claimant pairing, the engine now forbids that pairing structurally, and the row is gone from the regenerated ledger. Not deleted silently — the paragraph's history is worth keeping, reframed as resolved.

## Testing

- `src/assay/bookkeeper/admit.test.ts`: extend the existing table-driven "denies unsound proposals" cases with two new rows — a `from` referencing an independent document (`FROM_NOT_CLAIMANT`) and a `to` referencing a second, *different* claimant document (`TO_NOT_INDEPENDENT`). A third corpus fixture (a second independent doc, a second claimant doc, or both) is needed beyond the existing two-doc `CORPUS`; the plan decides the minimal addition. Confirm the existing `SELF_PAIR` case (same-document pair) is unaffected by the new checks' ordering — it still reports `SELF_PAIR`, not `TO_NOT_INDEPENDENT`.
- `src/assay/isolation.test.ts` and every existing calibration suite (Receipts', Claim/Record's) must still pass unchanged — none of their fixtures rely on same-role pairing.
- `npm run typecheck`, `npx vitest run` clean in both repos after the engine copy; `diff -rq receipts/src/assay claim-record/src/assay` empty.
- `npm run replay` on `main`, after the regeneration task, reports `1 replayed, 3 not replayable`.

## Error handling

| Where | Condition | Behaviour |
|---|---|---|
| `admit()` | `from`'s document role is not `claimant` | deny `FROM_NOT_CLAIMANT`, detail is `from.docId`; no anchor attempted |
| `admit()` | `to` is present and its document role is not `independent` | deny `TO_NOT_INDEPENDENT`, detail is `to.docId`; checked after `SELF_PAIR`, before the `to`-side anchor |

## Out of scope

- Restructuring `sides` into role-keyed fields.
- Any prompt change in either repo (the invariant is now engine-enforced; no prompt currently claims otherwise).
- Claim/Record calibration additions (nothing in its lexicon or fixtures exercises same-role pairing today).
- A live A/B measuring whether removing the capability changed anything for Claim/Record's legal domain — it was never tried there.
