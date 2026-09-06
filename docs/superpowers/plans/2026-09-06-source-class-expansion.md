# Source Class Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six source classes — two as templated defaults, one as an industry lookup table, three hand-researched into the existing plan files — with every guessed URL verified by a real fetch before it is trusted.

**Architecture:** A new `src/sources/regulators.ts` holds the industry table and a pure lookup; `buildSourcePlan` gains an optional `industry` override and two new default targets. The probe run comes *before* the defaults are committed, not after.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, tsx.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-06-source-class-expansion-design.md`. Every task serves it.
- **No URL guess enters `buildSourcePlan`'s defaults until Task 2's probe has fetched it.** BBB's
  profile shape, Downdetector's, and NHTSA's query parameters are all unverified. This project
  has twice paid to unwind a default committed on an assumption — the `smart` proxy that
  attached no proxy, and G2's "one in four" that was one in twelve.
- **No `SourceKind` values are added.** BBB and Downdetector are `review_site` (the shape G2
  already uses); a regulator index page is `status_page` (the shape `plans/tesla-fsd.json`
  already uses for NHTSA); CourtListener is `forum` (the shape Hacker News already uses).
- **Nothing is invented to fill a slot.** If a subject has no real benchmark aggregator or
  docket worth citing, it gets none. A missing source is honest; a fabricated one is the exact
  failure this tool exists to expose.
- The three plan files are `plans/tesla-fsd.json`, `plans/vercel.json` and
  `plans/ai-model-claims.json` (the Claude subject — there is no `plans/claude.json`).
- Tests: `npm test -- src/`. **This does not exclude the foreign `solari-receipts/` directory**
  — vitest treats the argument as a substring filter, not a path scope, so that unrelated
  nested project's one test file always fails to load and the exit code is always non-zero.
  Read the **Tests** count, not the exit code. Baseline is **356 passed**.
- Types: `npm run typecheck`, expects no output. Both checked before every commit.
- Commit after every task. Never `--no-verify`. Branch: `source-class-expansion`.

---

## Amendment — 2026-09-06, after Task 2's probe

The probe measured all three guessed URLs. Two failed, and one failure changes this plan's
shape rather than just its content.

- **Downdetector passes.** Subject-specific, substantive. It goes into the defaults.
- **BBB fails on substance.** The shape works; Vercel has no profile. 1,841 characters of
  chrome around "No results for Vercel". Not added.
- **NHTSA's `?make=` is dead** — the parameter is ignored, zero occurrences of the subject in
  8,452 characters. A follow-up probe found `api.nhtsa.gov/recalls/recallsByVehicle` returns
  genuinely excellent data (dated, quotable recall summaries), **but it requires `make` AND
  `model` AND `modelYear`.** Make alone returns `Count:0`. Two of three parameters are not
  derivable from a company name.

**Consequence, decided by the human:** the lookup table keeps its mechanism and loses its only
entry. `regulatorTargets` and the `industry` override still land — they are correct, tested
code — but the table ships empty, awaiting a regulator that is genuinely name-derivable. The
working NHTSA URL moves to hand-research (Task 5), which is where the evidence says a source
needing three per-subject parameters belongs.

**A second decision:** the probe exposed a live defect in `src/fetch/fan.ts` — BBB's
no-results page cleared the no-results gate because `NO_RESULT_MAX_CHARS` is 600 and the page
is 1,841 characters, so a page whose whole content is chrome plus a statement of its own
emptiness entered the corpus as a readable document. `fan.ts` was outside this plan's original
file scope; it is now in scope, as Task 4, because this branch is actively adding
search-page-shaped sources and the hazard is live rather than theoretical.

Task numbering below: Task 3 is revised, Task 4 is new, and the original Tasks 4 and 5 become
Tasks 5 and 6.

---

### Task 1: The industry lookup table

Built first because it is pure, offline, and Task 2's probe needs its URL to test.

**Files:**
- Create: `src/sources/regulators.ts`
- Create: `src/sources/regulators.test.ts`

**Interfaces:**
- Produces: `Industry` (`"automotive"`), `regulatorTargets(industry: Industry, subject: string): SourceTarget[]`

- [ ] **Step 1: Write the failing tests**

Create `src/sources/regulators.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { regulatorTargets } from "./regulators.js"

describe("regulatorTargets — the regulator is never the claimant", () => {
  it("returns at least one target for a known industry", () => {
    expect(regulatorTargets("automotive", "Tesla").length).toBeGreaterThan(0)
  })

  // A regulator writes about the vendor, never as the vendor. Getting this
  // wrong would file a safety regulator's findings under the company's own
  // claims -- the false attribution the whole ledger exists to prevent.
  it("marks every target independent", () => {
    for (const target of regulatorTargets("automotive", "Tesla")) {
      expect(target.role).toBe("independent")
    }
  })

  it("carries the subject into the url", () => {
    for (const target of regulatorTargets("automotive", "Tesla")) {
      expect(target.url.toLowerCase()).toContain("tesla")
    }
  })

  it("url-encodes a subject with a space", () => {
    for (const target of regulatorTargets("automotive", "General Motors")) {
      expect(target.url).not.toContain(" ")
    }
  })

  it("uses only SourceKind values the project already has", () => {
    const known = new Set(["vendor_site", "vendor_docs", "vendor_pricing",
      "status_page", "review_site", "forum", "changelog"])
    for (const target of regulatorTargets("automotive", "Tesla")) {
      expect(known.has(target.kind)).toBe(true)
    }
  })

  it("gives every target a non-empty label", () => {
    for (const target of regulatorTargets("automotive", "Tesla")) {
      expect(target.label.length).toBeGreaterThan(0)
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/sources/regulators.test.ts`
Expected: FAIL — cannot resolve `./regulators.js`.

- [ ] **Step 3: Implement**

Create `src/sources/regulators.ts`:

```ts
import type { SourceTarget } from "../types.js"

/**
 * Industries this project has a subject for. One member, deliberately.
 *
 * Fintech, telecom and health entries are not pre-populated: there is no
 * subject in this repository to justify them, and inventing them would be
 * guessing at URL shapes for companies that do not exist here.
 *
 * The type is the guard. While the union is small, a typo is a compile error
 * rather than a silently missing source, which is worth more than a runtime
 * check would be.
 */
export type Industry = "automotive"

/**
 * What a lookup table can honestly hold for a regulator.
 *
 * Not a document. The SEC filing in `plans/tesla-fsd.json` is
 * `.../edgar/data/1318605/000162828025003063/tsla-20241231.htm` -- a specific
 * CIK and accession number, hand-found, and no slug produces it. Regulator
 * dockets are not shaped like `g2.com/products/<slug>/reviews`.
 *
 * So this holds a per-industry *search page*, parameterised by the vendor's
 * name, fetched and read as-is -- the same shape the Hacker News entry in
 * `buildSourcePlan` already uses. Its yield is unproven and probably lower
 * than a hand-found filing: a listing of recall titles and dates is not the
 * quotable substance a 10-K's own text carries. This mechanism produces real,
 * fetchable targets; it does not manufacture that quality of source on demand.
 */
const REGULATORS: Record<Industry, (subject: string) => SourceTarget[]> = {
  automotive: (subject) => [
    {
      kind: "status_page",
      role: "independent",
      url: `https://www.nhtsa.gov/recalls?make=${encodeURIComponent(subject)}`,
      label: `NHTSA recalls — ${subject}`,
    },
  ],
}

/**
 * Pure: the regulator index pages worth reading for a vendor in this industry.
 *
 * Returns `[]` rather than throwing when the union has a member the table has
 * not gained yet -- the one case the types cannot catch, and one this project
 * would rather see as an absent source than as a failed run.
 */
export function regulatorTargets(industry: Industry, subject: string): SourceTarget[] {
  return REGULATORS[industry]?.(subject) ?? []
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/sources/regulators.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 5: Verify the suite and typecheck**

Run: `npm test -- src/`
Expected: **362 passed** (356 baseline + 6 new). One foreign file still fails to load and the
exit code is still non-zero — see Global Constraints; judge by the passed count.

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/sources/regulators.ts src/sources/regulators.test.ts
git commit -m "feat(receipts): an industry table for regulator index pages

Seeded with one entry, because one of the three subjects is automotive and
none is fintech or telecom -- inventing those would be guessing at URL
shapes for companies that do not exist in this repository.

The table holds a search page, not a document, and the doc comment says why:
the SEC filing already in the Tesla plan is a specific CIK and accession
number that no slug produces. A per-industry index page is what a lookup can
honestly hold, and its yield is unproven -- worth stating where the mechanism
lives rather than only in a spec nobody rereads.

The NHTSA query shape is not yet verified. Nothing consumes this table until
a real fetch confirms it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Probe the three guessed URLs before trusting any of them

Three URL shapes are guesses: BBB's profile path, Downdetector's status path, and NHTSA's
`?make=` parameter. This task finds out which are real. **It is the gate on Task 3** — a shape
that fails here does not become a default.

**Files:**
- Create: `plans/probe-source-classes.json`
- Create: `fixtures/probe-source-classes.json` (the run's output)

- [ ] **Step 1: Write a throwaway plan carrying only the guesses**

`buildSourcePlan`'s defaults are not touched yet, so the probe needs its own plan file.
`readSourcePlan` requires both a `claimant` and an `independent` target or it refuses the plan,
so a known-good vendor page is included to satisfy that and to prove the run itself worked.

Create `plans/probe-source-classes.json`:

```json
{
  "subject": "Vercel",
  "targets": [
    { "kind": "vendor_site", "role": "claimant",
      "url": "https://vercel.com",
      "label": "Vercel homepage (control)" },
    { "kind": "review_site", "role": "independent",
      "url": "https://www.bbb.org/search?find_text=Vercel",
      "label": "BBB search — Vercel" },
    { "kind": "review_site", "role": "independent",
      "url": "https://downdetector.com/status/vercel/",
      "label": "Downdetector — Vercel" },
    { "kind": "status_page", "role": "independent",
      "url": "https://www.nhtsa.gov/recalls?make=Tesla",
      "label": "NHTSA recalls — Tesla (url shape probe)" }
  ]
}
```

The NHTSA entry uses Tesla deliberately: this probe is testing whether the *URL shape* returns
anything, and Vercel is not a vehicle manufacturer, so a Vercel-parameterised NHTSA URL would
return an empty result that proves nothing about the shape.

- [ ] **Step 2: Run the probe**

```bash
npm run cli -- vercel --fetch-only --sources plans/probe-source-classes.json --snapshot fixtures/probe-source-classes.json
```

Expected: four rows on stderr. The control (`Vercel homepage`) must read — if it does not, the
run itself is broken and nothing else in the output means anything.

- [ ] **Step 3: Record what each of the three actually returned**

For each of BBB, Downdetector and NHTSA, note from the snapshot: `read` with a character count,
or the failure `reason` and `detail`. A `blocked` result is as informative as a read one.

Judge each on whether the page carried **substantive content about the subject**, not merely on
whether it returned bytes. A search page that loaded but matched nothing is a shape that works
attached to a query that does not, and those are different problems with different fixes.

- [ ] **Step 4: Commit the measurement**

```bash
git add plans/probe-source-classes.json fixtures/probe-source-classes.json
git commit -m "run(receipts): probe three guessed source URLs before trusting them

BBB's profile path, Downdetector's status path and NHTSA's ?make= parameter
were all guesses. This is what they actually return.

The control row exists so a broken run cannot be mistaken for three blocked
sources.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire through what the probe proved, and empty the table it disproved

Downdetector is the only guessed URL that passed. BBB is not added. The regulator table keeps
its mechanism and loses its entry.

**Files:**
- Modify: `src/sources/regulators.ts`, `src/sources/regulators.test.ts`
- Modify: `src/sources/plan.ts`, `src/sources/plan.test.ts`

**Interfaces:**
- Consumes: `Industry`, `regulatorTargets` (Task 1).
- Produces: `buildSourcePlan(subject, { domain?, industry?, extra? })`; `REGULATORS` becomes a
  `Partial<Record<Industry, ...>>` with no entries.

- [ ] **Step 1: Empty the regulator table, and re-type it so that is expressible**

`REGULATORS` is currently `Record<Industry, ...>`, which **requires** an `automotive` key —
deleting the entry without changing the type is a compile error. Change the declaration to:

```ts
const REGULATORS: Partial<Record<Industry, (subject: string) => SourceTarget[]>> = {
  // Empty, deliberately, and this is a measurement rather than an oversight.
  //
  // `automotive` pointed at `nhtsa.gov/recalls?make=<subject>`. The probe in
  // fixtures/probe-source-classes.json shows that parameter is ignored: zero
  // occurrences of "Tesla" in 8,452 characters of generic landing page.
  //
  // The NHTSA data worth having is real -- api.nhtsa.gov/recalls/recallsByVehicle
  // returns dated, quotable recall summaries -- but it needs make AND model AND
  // modelYear, and make alone returns Count:0
  // (fixtures/probe-nhtsa-shapes.json). Two of those three cannot be derived
  // from a company name, so that URL belongs in a per-subject plan file, not in
  // a name-keyed table. It is in plans/tesla-fsd.json for exactly that reason.
  //
  // This table awaits a regulator that genuinely is name-derivable.
}
```

**`regulatorTargets`'s doc comment is now wrong again and must be updated.** It currently says
TypeScript's exhaustiveness on `Record` is the guard and the `?? []` only fires for unsafe
casts. Under `Partial`, that is no longer true: a missing entry is now a normal, typed,
reachable case. Replace that doc comment with:

```ts
/**
 * Pure: the regulator index pages worth reading for a vendor in this industry.
 *
 * Returns `[]` for an industry the table has no entry for, which today is every
 * industry -- see the note on REGULATORS. Under `Partial<Record<...>>` this is a
 * normal typed case rather than a defensive one, and returning `[]` rather than
 * throwing keeps the invariant that one absent source never fails a whole run.
 */
```

- [ ] **Step 2: Fix the tests the empty table breaks**

Five of the six cases in `src/sources/regulators.test.ts` iterate over
`regulatorTargets("automotive", ...)` and assert properties of what it returns. With an empty
table those loops have nothing to iterate, so they pass **vacuously** — and one,
`"returns at least one target for a known industry"`, now fails outright.

Replace the entire `describe` block with one that tests what the function actually does now:

```ts
describe("regulatorTargets — a mechanism awaiting a name-derivable regulator", () => {
  // The table is empty on purpose. NHTSA's name-only URL was measured and does
  // not work; the URL that does needs make, model and modelYear, so it lives in
  // plans/tesla-fsd.json instead. See the note on REGULATORS.
  it("returns no targets while the table has no entries", () => {
    expect(regulatorTargets("automotive", "Tesla")).toEqual([])
  })

  // This guarantee has no target to bind to today. It is kept as an executable
  // requirement on whatever entry the table gains next, rather than as four
  // separate assertions looping over an empty array and checking nothing --
  // which is what the previous version of these tests had become.
  it("would mark every target independent and labelled, whenever an entry exists", () => {
    const targets = regulatorTargets("automotive", "Tesla")
    expect(targets.every((t) => t.role === "independent")).toBe(true)
    expect(targets.every((t) => t.label.length > 0)).toBe(true)
  })
})
```

Two cases, not six: the four that iterated an empty array were asserting nothing, and keeping
them would mean four green tests that verify no behaviour at all.

- [ ] **Step 3: Write the failing tests for `buildSourcePlan`**

Append to `src/sources/plan.test.ts`'s existing `describe("buildSourcePlan", ...)` block:

```ts
  it("includes a Downdetector status page in the defaults", () => {
    expect(buildSourcePlan("acme").targets.some((t) => t.url.includes("downdetector.com")))
      .toBe(true)
  })

  // BBB was probed and left out: its URL shape works, but the page it returns
  // for a vendor with no profile is chrome wrapped around "No results".
  it("does not include BBB", () => {
    expect(buildSourcePlan("acme").targets.some((t) => t.url.includes("bbb.org")))
      .toBe(false)
  })

  it("accepts an industry override without adding targets while the table is empty", () => {
    const withIndustry = buildSourcePlan("Tesla", { domain: "tesla.com", industry: "automotive" })
    const without = buildSourcePlan("Tesla", { domain: "tesla.com" })
    expect(withIndustry.targets.length).toBe(without.targets.length)
  })
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test -- src/sources/`
Expected: FAIL — `downdetector.com` is in no default target, and `industry` is not a known
property of the overrides object.

- [ ] **Step 5: Implement**

In `src/sources/plan.ts`, add to the imports:

```ts
import { regulatorTargets, type Industry } from "./regulators.js"
```

Change the signature:

```ts
export function buildSourcePlan(
  subject: string,
  overrides: { domain?: string; industry?: Industry; extra?: SourceTarget[] } = {},
): SourcePlan {
```

Add the Downdetector line to the `targets` array, immediately after the existing G2 line:

```ts
    { kind: "review_site", role: "independent", url: `https://downdetector.com/status/${slug}/`, label: "Downdetector" },
```

and append regulator targets just before `overrides.extra`, so both pass through the existing
dedup filter:

```ts
    ...(overrides.industry ? regulatorTargets(overrides.industry, subject) : []),
    ...(overrides.extra ?? []),
```

- [ ] **Step 6: Verify**

Run: `npm test -- src/`
Expected: **362 passed** — 363 before, minus 4 removed regulator cases, plus 3 new
`buildSourcePlan` cases. Foreign-file caveat as always: one file fails to load, exit code
non-zero, judge by the passed count.

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 7: Commit**

Commit `src/sources/` with a message recording: that Downdetector went in and BBB did not, with
the measured reason for each; that the regulator table kept its mechanism and lost its entry,
with the NHTSA measurement that decided it; that re-typing `REGULATORS` as `Partial` made the
`?? []` a normal typed case and its doc comment needed correcting a second time; and that four
of the six regulator tests were iterating an empty array and asserting nothing.

---

### Task 4: A no-results page is not a document, at any length

The probe caught this live: BBB's "No results for Vercel" page is 1,841 characters, and
`NO_RESULT_MAX_CHARS` is 600, so it cleared the no-results gate on length alone and entered the
corpus as a readable document. `fan.ts` already documents three prior instances of this exact
pattern; this is a fourth, found by a run rather than by reading.

**Files:**
- Modify: `src/fetch/fan.ts`
- Modify: `src/fetch/fan.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/fetch/fan.test.ts`. Build the fixture from BBB's real captured page — read it
out of `fixtures/probe-source-classes.json` (the row labelled `BBB search — Vercel`) and paste
its text as a string constant named `BBB_NO_RESULTS`, preserving its newlines. Do not
paraphrase it; the point of the test is that it is the page that actually got through.

```ts
describe("classifyFailure — a search page that matched nothing, at any length", () => {
  it("flags BBB's real no-results page as empty", () => {
    expect(classifyFailure("BBB Search", BBB_NO_RESULTS)).toBe("empty")
  })

  it("is a page long enough to clear the old 600-character bound", () => {
    expect(BBB_NO_RESULTS.length).toBeGreaterThan(600)
  })

  // The bound exists so an article that happens to say "no results" in passing
  // is not thrown away. That protection must survive the fix.
  it("still does not flag a long article that mentions no results in passing", () => {
    expect(classifyFailure("Benchmarks", `${LONG.repeat(3)} no results were observed`))
      .toBeNull()
  })
})
```

`LONG` already exists at the top of that test file.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- src/fetch/fan.test.ts`
Expected: FAIL — the BBB page classifies as `null` (a readable document), not `"empty"`.

- [ ] **Step 3: Implement**

The fix must catch a longer no-results page **without** discarding a real article that mentions
the phrase in passing. Raising the bound alone trades one failure for the other, so the comment
has to carry why the number is not the guard.

In `src/fetch/fan.ts`, replace the `NO_RESULT_MAX_CHARS` constant and its doc comment:

```ts
/**
 * A search page that matched nothing is chrome plus a statement of its own
 * emptiness, and chrome is not short. The original bound was 600 characters,
 * chosen against Hacker News' 248-character empty result. BBB's is 1,841 --
 * measured, in fixtures/probe-source-classes.json -- and sailed straight
 * through, entering a corpus as a readable independent source.
 *
 * Raising the number alone only moves the line for the next site to cross. The
 * bound is kept generous and paired with a marker set that names the *page's
 * own subject*: "no results for", "0 results", "found no stories". An article
 * discussing search results in passing does not say those about itself, which
 * is what the long-article tests hold in place.
 */
const NO_RESULT_MAX_CHARS = 4000
```

Leave `NO_RESULT_MARKERS` and the check's structure unchanged; only the bound moves.

- [ ] **Step 4: Verify**

Run: `npm test -- src/`
Expected: **365 passed** (362 + 3 new). Every pre-existing `classifyFailure` case must still
pass — in particular the long-article cases, which are what stop this fix over-reaching.

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 5: Commit**

Commit `src/fetch/fan.ts` and `src/fetch/fan.test.ts`, recording: that this was found by the
branch's own probe rather than by reading; that BBB's page is 1,841 characters against a
600-character bound; that the bound was set against Hacker News' 248-character empty result and
was never a claim about how long such a page can be; and that the markers, not the number, are
what stop the fix over-reaching.

---

### Task 5: Hand-research the per-subject sources

The classes with no company-name-derivable URL: court records, independent measurement or
benchmark sites, and any regulator page more specific than Task 1's index page.

**Files:**
- Modify: `plans/tesla-fsd.json`, `plans/vercel.json`, `plans/ai-model-claims.json`

- [ ] **Step 1: Find real URLs, one subject at a time**

For each subject, look for sources that genuinely exist:

- **Tesla** (`plans/tesla-fsd.json`): a CourtListener docket or opinion for a specific,
  well-known Autopilot or FSD case — **CourtListener, not PACER** (free, no login, no paywall,
  no per-page fee); an NHTSA ODI investigation page for a specific investigation if one more
  targeted than the recall index exists; a community FSD-disengagement tracker publishing
  miles-per-disengagement figures.
- **Vercel** (`plans/vercel.json`): an independent uptime or performance measurement site
  covering Vercel, if a real one exists.
- **Claude** (`plans/ai-model-claims.json`): a benchmark aggregator publishing model results —
  the natural independent counterweight to a model card's own claims.

**Add nothing you cannot open and confirm carries content about the subject.** A plausible-
looking URL that 404s or covers a different company is worse than an absent source: it spends
a browser slot and lands in the ledger as a `not read` row implying the source refused us,
when the truth is we guessed wrong.

- [ ] **Step 2: Verify every added URL with a real fetch, per subject**

```bash
npm run cli -- tesla --fetch-only --sources plans/tesla-fsd.json --snapshot fixtures/tesla-fsd-expanded.json
```

Repeat for `vercel` and for `ai-model-claims`. Each newly added target must show `read` with a
non-trivial character count. If one is blocked or empty, either remove it or keep it with the
result recorded — but do not leave an unverified target in a committed plan.

- [ ] **Step 3: Confirm role assignment**

Every added source is `role: "independent"`. A court, a regulator, and a benchmark site all
write *about* the vendor, never *as* it. Filing any of them as `claimant` would put a
regulator's findings in the vendor's own column — the false attribution the ledger exists to
prevent.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/` and `npm run typecheck`
Expected: unchanged from Task 3 — plan JSON files carry no tests.

```bash
git add plans/ fixtures/
git commit -m "feat(receipts): hand-researched sources for the three subjects

Court records via CourtListener rather than PACER: free, no login, no
paywall -- the same readable-equivalent reasoning that made GitHub issues
the answer to Reddit.

Every added URL was fetched before being committed. Where a subject had no
real benchmark aggregator or docket worth citing, it got none: an empty slot
is honest and a fabricated one is the failure this tool exists to expose.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Make the documentation match what landed

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-04-density.md`

- [ ] **Step 1: Tick the density plan's Task 4 items that this branch completed**

That task lists **Regulator dockets** and **Independent measurement sites** as unticked. Tick
whichever this branch actually delivered, with a one-line note of what was added. Leave
unticked anything that was attempted and failed, with the reason — the same treatment
`webBotAuth` got when it turned out unavailable.

- [ ] **Step 2: Update the README's source-coverage table**

The table listing per-source outcomes gains rows for whatever was added, with the measured
result. If BBB or Downdetector was blocked, it appears with that outcome rather than being
quietly omitted — the `not read` column is the product, not an embarrassment.

- [ ] **Step 3: Verify and commit**

Run: `npm test -- src/` and `npm run typecheck`

```bash
git add README.md docs/superpowers/plans/2026-09-04-density.md
git commit -m "docs: record which source classes landed and which did not

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- `regulatorTargets` exists, is tested, is seeded with `automotive` only, and every target it
  returns is `role: "independent"`.
- `buildSourcePlan` takes an explicit `industry` override; passing none changes nothing about
  its output.
- Every URL in `buildSourcePlan`'s defaults and in the three plan files was fetched successfully
  before being committed. Nothing was added on a guess.
- Any source the probe showed blocked is recorded as blocked — in the commit that decided it,
  and in the README — rather than silently dropped.
- No new `SourceKind` values.
- Test count is 362 plus the cases Task 3's evidence justified.
