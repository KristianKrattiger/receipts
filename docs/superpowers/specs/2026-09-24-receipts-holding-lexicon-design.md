# Broaden receipts' holding lexicon to named-authority third-person findings

**Date:** 2026-09-24
**Status:** approved design
**Repos:** `receipts` only. Claim/Record has its own, separate lexicon (`Lexicon` is a per-field-profile value, not part of the shared `src/assay` engine) — nothing here touches it or needs syncing.

## Why

The final review of the `holding-competitor-fix` branch (disputed-status spec) found that none of receipts' 8 contradiction/update rows across its 4 committed example reports would keep `divergent` status under a fresh run: receipts' `holding` lexicon (`instance/profile.ts`) only recognizes first-person "we tested/measured" language, but real independent web sources — Hacker News threads, Wikipedia articles relaying a regulator's finding — essentially never talk about themselves that way.

Checked directly against `reports/tesla-fsd.json` (the one report regenerated under the current engine): all three of its `disputed` rows' independent quotes are from Hacker News or Wikipedia. Two are Hacker News headlines with no testing/attribution language at all (a crash report, a bare uncredited statistic) — correctly non-holding, residual curator work, not a lexicon gap. The third is Wikipedia's real sentence:

> "In May 2026, the National Highway Traffic Safety Administration (NHTSA) said that recent Tesla Model Ys are the first cars to pass the agency's new benchmark for advanced driver assistance systems."

This *is* a genuine holding — NHTSA is a named regulator, and "pass the agency's new benchmark" is exactly the kind of checked, authoritative finding the `holding` role exists to recognize — just phrased in third person ("the agency's benchmark") instead of first person ("our benchmark"). That's the real, narrow gap: **a named authority's own testing/measurement, stated about itself in the third person**, not a wholesale rethink of what counts as a holding (confirmed narrow scope with the project owner before designing this).

## Decision

Add three new alternatives to `LEXICON.holding` in `instance/profile.ts`, built from two shared parts (a role-noun class and a testing-noun class) rather than one flat regex, for readability:

```ts
const AUTHORITY_ROLE =
  "(?:agency|regulator|authority|administration|department|commission|board|institute|laboratory|lab|researchers?|investigators?)"
const TESTING_NOUN =
  "(?:tests?|testing|investigations?|studi(?:es|y)|measurements?|benchmarks?|findings?)"
const APOSTROPHE = "['’‘]" // straight ' and the curly '/' real page text uses
```

1. **A named authority's testing/investigation, as the subject of a finding verb** — "the regulator's investigation found no evidence of wrongdoing":
   `\b(?:the )?AUTHORITY (?:'s|s')(?:\s+\w+){0,2}\s+NOUN\s+(?:found|show(?:ed)?|confirm(?:ed)?|concluded)\b`
2. **"According to X's testing"** — already frames what follows as the finding, same precedent as the existing "according to our testing" branch, no trailing verb required:
   `\baccording to (?:the )?AUTHORITY(?:'s|s')(?:\s+\w+){0,2}\s+NOUN\b`
3. **Passing/meeting/failing a named authority's test/benchmark/standard** — the exact shape of the real Tesla/NHTSA sentence, which has no "found/showed" verb at all; the finding *is* "passed the benchmark":
   `\b(?:pass(?:es|ed)?|meets?|met|fails?|failed|satisf(?:y|ies|ied)) (?:the )?AUTHORITY(?:'s|s')(?:\s+\w+){0,2}\s+(?:tests?|testing|benchmarks?|standards?|requirements?|criteri(?:a|on))\b`

The `(?:\s+\w+){0,2}` slot allows up to two filler words between the possessive and the testing noun (needed for "the agency*'s* new benchmark" — "new" sits in between), while still being short enough to reject unrelated possessives ("the commission's long-delayed and much-criticized final report").

Pattern 1 requires a finding verb because the bare pattern (role-noun + possessive + testing-noun, no verb) was tried first and **rejected**: it also matched "the agency's report was delayed" and "the agency's investigation is ongoing" — process statements with no actual finding. Verified directly: the finding-verb requirement fixes both false positives without losing pattern 1's true positives.

The apostrophe class matters in practice, not just in theory: the real Tesla/NHTSA sentence uses a curly `'` (U+2019), and a naive literal `'` in the pattern silently fails to match real scraped page text — confirmed by testing against the actual sentence pulled from the committed snapshot, not a hand-typed paraphrase.

## Validation

20 cases, run against the actual composed regex (not a mental read of it):

**Must become holding (4):** the real, full Tesla/NHTSA sentence pulled from the committed snapshot (curly apostrophe, exact wording); a generic "according to the agency's testing" case; a generic "the regulator's investigation found" case; "researchers' testing confirmed" (plural role-noun, no "the").

**Must NOT become holding (13):** the existing `AGGREGATOR` fixture ("critics say..."); both real Hacker News quotes from `tesla-fsd.json` (crash headline, bare stat); the existing `FORUM` fixture; generic hearsay ("reportedly..."); an authority mentioned with no testing claim ("the agency plans to review..."); hearsay *about* a regulator ("some say the regulator will crack down"); the two false positives pattern 1's design iteration found and fixed (report delayed, investigation ongoing); a possessive with too many filler words to plausibly be one finding; a role-noun with no testing-noun nearby; a testing-noun present but not the actual subject of a finding; a role-noun mentioned in an unrelated sentence.

**Must stay holding, unchanged (3):** the existing `REVIEWER` fixture (×2 sentences) and `TESTER` fixture — none of the three new alternatives interact with or weaken the four pre-existing "our"/"we" alternatives.

All 20 passed. Validation script (not committed, scratch only) is reproducible from this spec's three regex fragments plus the case list above if anyone wants to re-run it.

## Engine changes

None. This is entirely `receipts/src/instance/profile.ts` (a field-profile lexicon value) — the shared `src/assay/` engine is untouched, so there is nothing to sync to Claim/Record.

## What changes downstream

`reports/tesla-fsd.json`'s NHTSA row: its independent quote's enclosing sentence currently classifies `unmarked` (hence `disputed`); under the new lexicon it classifies `holding`, and `blocksNonHolding` returns `null` immediately for a `holding`-role envelope (no competitor check even runs) — so the row's `contextUnverified` flag is never set, and it renders as a confident `divergent` row again, correctly reflecting that NHTSA's own finding *is* authoritative evidence. The two Hacker News rows are unaffected (neither has testing/authority language) and stay `disputed`. This needs a ledger regeneration (same free, cache-only technique used three times already this session) — the one already-flagged behavioral consequence to expect, not a surprise to react to mid-implementation.

`reports/claude.json`/`reports/vercel.json` are unaffected either way — both predate `context_unverified` entirely (never replayed since), so they are not live evidence of current behavior and this change doesn't touch them.

## Testing

- `src/instance/calibration/corpus.ts`: add a new fixture, `REGULATOR`, modeling the NHTSA-style pattern in this file's existing Acme-uptime domain (matching how `REVIEWER`/`TESTER`/`FORUM`/`AGGREGATOR` are already domain-adapted fixtures, not literal Tesla text): `"The safety regulator's testing confirmed Acme uptime failover exceeded ten seconds."` — verified directly against the composed regex (see Validation).
- `src/instance/calibration/calibration.test.ts`: add a new proposal constant and test in the existing `describe("Receipts calibration — a web lexicon can fire", ...)` block, mirroring the existing `ACCORDING_TO_TESTING_TWIN`/`TESTER` test exactly — a false claim marked `divergent` against `REGULATOR`'s third-person finding.
- `src/instance/profile.test.ts`: checked — it only tests the system prompt text (confidence-scale wording, tier differences, byte-length pins), no lexicon coverage at all. Leave it untouched; the calibration test above is the right place for this.
- `npm run typecheck`, `npx vitest run` clean.
- Regenerate `reports/tesla-fsd.json` (cache-only, no cost) and confirm exactly one row flips `disputed` → `divergent` (the NHTSA row), the other two stay `disputed`, nothing about what's admitted changes. Reconcile README's rendered Tesla example and any prose describing its row statuses, the same way the disputed-status plan's Task 3 did.
- `npm run replay` reports the same `1 replayed, 3 not replayable`, no diff, exit 0, after regeneration.

## Out of scope

- Enumerating every possible authority phrasing (inspectors general, auditors, watchdogs, court filings, press releases quoting a regulator directly, etc.) — the lexicon is explicitly closed and extractive, "corrected through calibration... not by inference at run time" (the file's own existing comment); this spec fixes the one concrete, validated gap found in real committed data, not a hypothetical exhaustive list.
- `reports/claude.json`/`reports/vercel.json` — legacy, pre-`context_unverified`, unaffected either way; regenerating them is a separate, already-noted pre-existing item, not part of this change.
- Any change to `issue`/`argument` lexicon entries, `blocksNonHolding`, `holdingCompetesWithClaim`, or anything in `src/assay/` — this is a field-profile value change only.
- Claim/Record — separate lexicon, separate domain (legal "we hold" language fits its holdings differently), not touched.
