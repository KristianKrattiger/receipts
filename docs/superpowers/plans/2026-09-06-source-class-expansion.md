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

### Task 3: Wire through only what the probe proved

**Files:**
- Modify: `src/sources/plan.ts`
- Modify: `src/sources/plan.test.ts`

**Interfaces:**
- Consumes: `Industry`, `regulatorTargets` from Task 1; Task 2's measured results.
- Produces: `buildSourcePlan(subject, { domain?, industry?, extra? })`

- [ ] **Step 1: Decide from the evidence, and write the decision down**

Before touching code, state — in the commit message you will write at Step 6 — which of BBB,
Downdetector and NHTSA the probe showed usable, and which are being left out. **A source the
probe showed blocked is not added to the defaults.** If a URL shape was wrong but the source
looks worth having, that is a corrected shape to re-probe, not a default to commit on hope.

If **none** of the three passed, that is a legitimate outcome: the `industry` parameter and
`regulatorTargets` still land (they are correct mechanisms with an unproven target), no new
defaults are added, and the plan proceeds to Task 4. Say so plainly rather than forcing
something in.

- [ ] **Step 2: Write the failing tests**

Append to `src/sources/plan.test.ts`'s existing `describe("buildSourcePlan", ...)` block. Write
**only** the cases matching what the probe proved:

```ts
  it("adds regulator targets when an industry is given", () => {
    const withIndustry = buildSourcePlan("Tesla", { domain: "tesla.com", industry: "automotive" })
    const without = buildSourcePlan("Tesla", { domain: "tesla.com" })
    expect(withIndustry.targets.length).toBeGreaterThan(without.targets.length)
  })

  // Absent industry must change nothing: every existing subject and every
  // committed fixture was built without it.
  it("adds nothing when no industry is given", () => {
    const urls = buildSourcePlan("acme").targets.map((t) => t.url)
    expect(urls.some((u) => u.includes("nhtsa.gov"))).toBe(false)
  })
```

Then, **for each source the probe passed**, one case asserting it appears in the defaults —
for example, if BBB passed:

```ts
  it("includes a BBB search in the defaults", () => {
    expect(buildSourcePlan("acme").targets.some((t) => t.url.includes("bbb.org"))).toBe(true)
  })
```

Do not write a test for a source you are not adding.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/sources/plan.test.ts`
Expected: FAIL — `industry` is not a known property of the overrides object, and any
default-target assertions do not match.

- [ ] **Step 4: Implement**

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

In the `targets` array, add a line **per source the probe proved** — for example, if BBB and
Downdetector both passed, alongside the existing G2 line:

```ts
    { kind: "review_site", role: "independent", url: `https://www.bbb.org/search?find_text=${encodeURIComponent(subject)}`, label: "BBB search" },
    { kind: "review_site", role: "independent", url: `https://downdetector.com/status/${slug}/`, label: "Downdetector" },
```

and append the regulator targets just before `overrides.extra`, so both flow through the
existing dedup filter:

```ts
    ...(overrides.industry ? regulatorTargets(overrides.industry, subject) : []),
    ...(overrides.extra ?? []),
```

- [ ] **Step 5: Verify**

Run: `npm test -- src/`
Expected: all passing, at a count matching 362 plus however many cases you wrote in Step 2.
Foreign-file caveat as always.

Run: `npm run typecheck`
Expected: no output.

- [ ] **Step 6: Commit, naming what was left out and why**

```bash
git add src/sources/plan.ts src/sources/plan.test.ts
git commit -m "feat(receipts): add the source defaults the probe actually proved

<name each of BBB / Downdetector / NHTSA as added or omitted, with the
measured reason for each omission -- a blocked source is a finding, not a
gap to paper over>

industry is an explicit override, never inferred. buildSourcePlan already
refuses to guess a domain when the guess would be unsafe; classifying a
company's industry automatically is a harder version of that problem and is
not attempted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Hand-research the per-subject sources

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

### Task 5: Make the documentation match what landed

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
