# Receipts Holding Lexicon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broaden receipts' `LEXICON.holding` to recognize a named authority's own testing/measurement stated in the third person (e.g. "the agency's benchmark found..."), closing the one real gap the disputed-status final review found in the committed Tesla ledger — without loosening it enough to catch bare mentions, process statements, or hearsay.

**Architecture:** A single field-profile value change (`src/instance/profile.ts`), one new calibration fixture and test proving it, and a regeneration of the one committed report this affects. No engine change, no Claim/Record involvement — `Lexicon` is a per-field-profile value, not part of the shared `src/assay/` engine.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

## Global Constraints

- The three new regex alternatives, the shared `AUTHORITY_ROLE`/`TESTING_NOUN`/`APOSTROPHE` fragments, and their exact composition are given verbatim below — copy them exactly, do not re-derive or "clean up" the pattern; every character was validated against 20 cases including a real scraped sentence with a curly apostrophe.
- Do not touch `blocksNonHolding`, `holdingCompetesWithClaim`, `issue`, `argument`, or anything in `src/assay/`.
- Do not touch Claim/Record — nothing in this plan applies there.
- Full spec: `docs/superpowers/specs/2026-09-24-receipts-holding-lexicon-design.md`.

---

## Task 1: Broaden `LEXICON.holding`, add the `REGULATOR` calibration fixture and test

**Files:**
- Modify: `src/instance/profile.ts` (`LEXICON.holding`)
- Modify: `src/instance/calibration/corpus.ts` (new `REGULATOR` fixture)
- Modify: `src/instance/calibration/calibration.test.ts` (new proposal constant + test)

**Interfaces:**
- Consumes: nothing from another task.
- Produces: `LEXICON.holding` now also matches the three new patterns; `REGULATOR` is a new named export from `corpus.ts`, used only by this task's own new test (no other file depends on it). Task 2 depends only on the resulting *behavior* (the Tesla ledger's NHTSA row now classifying as `holding`), not on any symbol from this task.

- [ ] **Step 1: Confirm the existing suite is green before touching anything**

Run: `npx vitest run src/instance/calibration/calibration.test.ts`
Expected: PASS, all 6 existing tests (the `TRUE_TWIN`/`FALSE_TWIN`/`RESIDUAL`/`HEARSAY`/`ACCORDING_TO_TESTING_TWIN` cases).

- [ ] **Step 2: Replace `LEXICON.holding` in `profile.ts`**

In `src/instance/profile.ts`, the lexicon block currently reads:

```ts
// The lexicon is a first draft. `holding` marks a source committing to its
// own test or measurement; `argument` marks attributed hearsay. It is closed
// and extractive like Claim/Record's, and corrected through
// src/instance/calibration/, not by inference at run time.
const LEXICON = {
  holding: /\b(?:we|our team) (?:tested|measured|benchmarked|confirmed|observed|verified)\b|\bour (?:tests?|testing|measurements?|benchmarks?) (?:found|show(?:ed)?|confirm(?:ed)?)\b|\bin our (?:tests?|testing|benchmarks?)\b|\baccording to our (?:tests?|testing|measurements?|benchmarks?)\b/i,
  issue: /(?!)/,
  argument: /\bcritics (?:argue|say|claim)\b|\bproponents (?:argue|say|claim)\b|\bsome (?:say|argue|claim)\b|\breportedly\b|\ballegedly\b|\baccording to\b/i,
}
```

Replace it with (three new named constants above `LEXICON`, then `LEXICON.holding` built from them plus the four existing first-person alternatives — `issue` and `argument` are unchanged):

```ts
// The lexicon is a first draft. `holding` marks a source committing to its
// own test or measurement, first- or third-person; `argument` marks
// attributed hearsay. It is closed and extractive like Claim/Record's, and
// corrected through src/instance/calibration/, not by inference at run time.
//
// The named-authority alternatives below exist because real independent web
// sources (regulators relayed by news coverage, Wikipedia summarizing an
// agency's finding) almost never use first-person "we tested" language —
// see docs/superpowers/specs/2026-09-24-receipts-holding-lexicon-design.md.
// A bare "authority's testing/report" alternative (no finding verb required)
// was tried and rejected: it also matched "the agency's report was delayed"
// and "the agency's investigation is ongoing" — process statements, not
// findings. Every alternative below requires either a finding verb or the
// "according to" framing that already implies one.
const AUTHORITY_ROLE =
  "(?:agency|regulator|authority|administration|department|commission|board|institute|laboratory|lab|researchers?|investigators?)"
const TESTING_NOUN =
  "(?:tests?|testing|investigations?|studi(?:es|y)|measurements?|benchmarks?|findings?)"
// Real scraped text uses a curly apostrophe; a literal ' silently misses it.
const APOSTROPHE = "['’‘]"

const LEXICON = {
  holding: new RegExp(
    String.raw`\b(?:we|our team) (?:tested|measured|benchmarked|confirmed|observed|verified)\b` +
    String.raw`|\bour (?:tests?|testing|measurements?|benchmarks?) (?:found|show(?:ed)?|confirm(?:ed)?)\b` +
    String.raw`|\bin our (?:tests?|testing|benchmarks?)\b` +
    String.raw`|\baccording to our (?:tests?|testing|measurements?|benchmarks?)\b` +
    `|\\b(?:the )?${AUTHORITY_ROLE}(?:${APOSTROPHE}s|s${APOSTROPHE})(?:\\s+\\w+){0,2}\\s+${TESTING_NOUN}\\s+(?:found|show(?:ed)?|confirm(?:ed)?|concluded)\\b` +
    `|\\baccording to (?:the )?${AUTHORITY_ROLE}(?:${APOSTROPHE}s|s${APOSTROPHE})(?:\\s+\\w+){0,2}\\s+${TESTING_NOUN}\\b` +
    `|\\b(?:pass(?:es|ed)?|meets?|met|fails?|failed|satisf(?:y|ies|ied)) (?:the )?${AUTHORITY_ROLE}(?:${APOSTROPHE}s|s${APOSTROPHE})(?:\\s+\\w+){0,2}\\s+(?:tests?|testing|benchmarks?|standards?|requirements?|criteri(?:a|on))\\b`,
    "i",
  ),
  issue: /(?!)/,
  argument: /\bcritics (?:argue|say|claim)\b|\bproponents (?:argue|say|claim)\b|\bsome (?:say|argue|claim)\b|\breportedly\b|\ballegedly\b|\baccording to\b/i,
}
```

- [ ] **Step 3: Add the `REGULATOR` fixture to `corpus.ts`**

In `src/instance/calibration/corpus.ts`, add after the existing `TESTER` export (currently lines 21-23):

```ts
/** A named authority's own finding, third person — a web "holding" too, not just first-person "we". */
export const REGULATOR = doc("regulator", "independent",
  "The safety regulator's testing confirmed Acme uptime failover exceeded ten seconds.")
```

- [ ] **Step 4: Write the failing test in `calibration.test.ts`**

In `src/instance/calibration/calibration.test.ts`, change the import (currently line 7):

```ts
import { AGGREGATOR, FORUM, goldCorpus, REVIEWER, SUBJECT, TESTER } from "./corpus.js"
```

to:

```ts
import { AGGREGATOR, FORUM, goldCorpus, REGULATOR, REVIEWER, SUBJECT, TESTER } from "./corpus.js"
```

Add this proposal constant after the existing `ACCORDING_TO_TESTING_TWIN` (currently ends line 46):

```ts
const REGULATOR_TWIN = proposal({
  proposalId: "regulator", type: "contradicts",
  from: { docId: "vendor", quote: "Acme uptime failover completes in under one second" },
  to: { docId: "regulator", quote: "The safety regulator's testing confirmed Acme uptime failover exceeded ten seconds" },
})
```

Add this test at the end of the `describe("Receipts calibration — a web lexicon can fire", ...)` block (currently ends after the `ACCORDING_TO_TESTING_TWIN` test, line 81, just before the block's closing `})`):

```ts
  it("marks a false claim divergent against a named authority's third-person finding", () => {
    const { assembled } = run([REGULATOR], [REGULATOR_TWIN])
    expect(assembled.outcome).toBe("ledger")
    if (assembled.outcome !== "ledger") return
    expect(assembled.rows[0]!.status).toBe("divergent")
  })
```

- [ ] **Step 5: Run the new test alone — confirm it fails, then passes**

Run: `npx vitest run src/instance/calibration/calibration.test.ts -t "named authority's third-person finding"`
Expected before Step 2: FAIL — `assembled.rows[0]!.status` is `"disputed"`, not `"divergent"` (the regulator's sentence classifies `unmarked` under the old lexicon, so `contextUnverified` is set and the contradiction renders as `disputed`). After Step 2: PASS.

- [ ] **Step 6: Run the full receipts suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: both clean. No other test file references `LEXICON.holding` or constructs its own copy of this regex, so no fallout is anticipated — if something else does fail, read the failure before assuming it's unrelated.

- [ ] **Step 7: Commit**

```bash
git add src/instance/profile.ts src/instance/calibration/corpus.ts src/instance/calibration/calibration.test.ts
git commit -m "$(cat <<'EOF'
Broaden the holding lexicon to named-authority third-person findings

Real independent web sources (regulators relayed by news coverage,
Wikipedia summarizing an agency's own finding) almost never use
first-person "we tested" language. Three new alternatives recognize
a named authority's own testing/measurement/benchmark, validated
against 20 cases including the real Tesla/NHTSA snapshot sentence
(curly apostrophe) and two false positives (process statements with
no finding) caught and excluded during design. See
docs/superpowers/specs/2026-09-24-receipts-holding-lexicon-design.md.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Regenerate the Tesla ledger and reconcile README

**Files:**
- Modify: `reports/tesla-fsd.json` (regenerated from cache, not hand-edited)
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1's broadened lexicon.
- Produces: nothing further tasks depend on.

- [ ] **Step 1: Confirm the pre-regeneration baseline**

By this point, Task 1's lexicon change is committed but `reports/tesla-fsd.json` on disk still reflects the old lexicon.

Run: `npm run replay`
Expected: `0 replayed, 3 not replayable`, plus a diff line for `reports/tesla-fsd.json` (the NHTSA row's status differs), non-zero exit code. This is the expected starting state this task fixes, not a bug.

- [ ] **Step 2: Regenerate `reports/tesla-fsd.json` from the cache**

Use the same cache-only technique as the prior three restamps this session (reconstruct the corpus the way `runReplay` does, re-run `admit()`/`assemble()` against the already-cached proposal responses — no network call, no cost — write the result back, keeping every field except `rows`/`audit` byte-identical to the committed file). Confirmed in advance (spec's "What changes downstream" section, checked directly against the real snapshot text): the NHTSA row's independent quote now has a `holding`-classified enclosing sentence, so `blocksNonHolding` returns `null` for it without ever setting `contextUnverified` — it flips from `disputed` back to `divergent`. The other two rows (both Hacker News, neither with testing/authority language) are unaffected and stay `disputed`.

- [ ] **Step 3: Confirm the regenerated ledger**

Run: `npm run replay`
Expected: `1 replayed, 3 not replayable`, no diff line, exit code 0.

Inspect `reports/tesla-fsd.json`'s `rows`: exactly one row (the NHTSA/"the National Highway Traffic Safety Administration" one) now reads `"status": "divergent"`; the other two (the Hacker News rows) still read `"status": "disputed"`. `audit.disputed` drops from `3` to `2`. If the counts don't match this exactly — e.g. more than one row flips, or the wrong row flips — stop and report BLOCKED; that would mean the lexicon change matched something unintended, not something this task should paper over.

- [ ] **Step 4: Render the regenerated ledger and reconcile README**

Run:
```bash
npm run cli -- tesla --render reports/tesla-fsd.json
```
Compare the real output against every passage in `README.md` that currently shows or describes this ledger's row statuses:
- The fenced "ledger in full (unedited)" block (currently starting around line 106, with the header at line 110 reading `DISPUTED — unmarked independent quote, no competing holding`) — read the real render output and paste it verbatim; the block will now show a mix (one `DIVERGENT` section, one `DISPUTED` section) rather than a single status.
- The paragraph beginning "All three disputed rows cite the same Tesla sentence…" (currently around line 165) — this is no longer accurate once one row is `divergent`; rewrite it to describe the actual split (which one is now `divergent` — the NHTSA/agency-benchmark row — and why; which two stay `disputed` and why), re-verifying the paragraph's other claims (which sentence, which sources) still hold rather than assuming they do.
- The `audit:` summary line and its surrounding prose, and the `provenance:` line — re-verify against the regenerated report's real `audit` object rather than assuming only the row statuses changed; admitted/denied counts should be unchanged (this task doesn't change what's admitted, only how one already-admitted row is classified), but confirm rather than assume.
- Do NOT touch the two other `DIVERGENT` fenced blocks in README (around lines 208 and 284) — they belong to `reports/vercel.json` and `reports/claude.json`, different ledgers this task does not regenerate (confirmed in the disputed-status plan's Task 3 — same exclusion applies here).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: both clean. No test file should assert `"disputed"` for the NHTSA row specifically — if one does, update it to `"divergent"` the same way prior tasks in this session have handled ledger-content fallout, and note it in your report since it wasn't anticipated here.

- [ ] **Step 6: Commit**

```bash
git add reports/tesla-fsd.json README.md
git commit -m "$(cat <<'EOF'
Regenerate the Tesla ledger with the broadened holding lexicon

The NHTSA row's independent quote is now recognized as a named
authority's own finding (third-person "the agency's benchmark"),
so it flips from disputed back to a confident divergent -- the
authoritative counter-evidence it actually is. The two Hacker News
rows (neither with testing/authority language) are unaffected.
README's rendered example and prose reconciled against a real
--render of the regenerated ledger.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Final check (whole-branch review, after both tasks)

- `npm run typecheck && npx vitest run && npm run replay` — replay must report `1 replayed, 3 not replayable`, identical to itself.
- Confirm `reports/claude.json`/`reports/vercel.json` and their README passages are untouched.
- Confirm no `src/assay/` file was touched — `git diff --stat` across both tasks' commits should show only `src/instance/`, `reports/tesla-fsd.json`, and `README.md`.
