# Source Class Expansion — Design Spec

**Date:** 2026-09-06
**Status:** approved

## Summary

Reddit and G2 are both settled as unreadable, on evidence. Coverage has to grow somewhere
else. This spec adds six source classes, split across three mechanisms according to what each
class can honestly support: two become templated defaults for every future subject, one
becomes a real lookup table keyed by industry, and three are hand-researched into the three
existing plan files.

The split is not organisational tidiness. It follows from a fact about URLs: only two of the
six have a shape derivable from a company name.

## Motivation

The readable sources this project has found all share a property: someone wrote them under a
duty of accuracy or specificity. The SEC 10-K, GitHub issues, status-page postmortems, and
Wikipedia all read cleanly; the two that refuse — Reddit and G2 — are the two where the
content is anonymous user opinion behind a commercial bot defence. Growing coverage means
finding more of the first kind, not fighting harder for the second.

Two of the six classes below were already argued for in
`docs/superpowers/plans/2026-09-04-density.md` Task 4 and left unticked. Four are new.

## The three mechanisms, and why the split falls where it does

### A. Templated defaults — BBB and Downdetector

`buildSourcePlan` already guesses `g2.com/products/<slug>/reviews` from a vendor's name. BBB
and Downdetector have the same property: a company-name-derived profile URL. They can join the
default target list on the same terms, and every future subject gets them for free.

**Gated on a probe.** Neither is added to the defaults until one fetch-only run against Vercel
shows what they actually return. This project has twice committed a default on an assumption
instead of a measurement — the `smart` proxy that attached no proxy, and G2's "one in four"
solve rate that turned out to be one in twelve — and both cost more to unwind than the probe
would have cost to run. If either is blocked, it does not go in.

### B. A real lookup table — the vertical-specific regulator

**What a lookup table can and cannot hold here.** The SEC filing already in
`plans/tesla-fsd.json` is
`sec.gov/Archives/edgar/data/1318605/000162828025003063/tsla-20241231.htm` — a specific CIK and
a specific filing's accession number, hand-found. No slug produces it. Regulator dockets are
not shaped like `g2.com/products/<slug>/reviews`, and a table pretending otherwise would emit
URLs that 404.

What the table can hold is a **search or index page per industry**, parameterised by the
vendor's name — the same shape the existing Hacker News entry already uses
(`hn.algolia.com/?q=<domain>`), fetched and read as-is rather than followed into a result.
Concretely: `"automotive"` maps to NHTSA's recall search for that make.

**Stated plainly because it would be easy to oversell:** the yield of an index page is
unproven and probably lower than a hand-found filing. A listing of recall titles and dates is
not the same quotable substance as a 10-K's own "certain advanced driver assist systems". The
lookup table is a real mechanism that produces real, fetchable targets; it is not a way to
manufacture Tesla-10-K-quality sources on demand, and nothing in this spec should be read as
claiming it is.

**NHTSA's exact query-parameter shape is not known to be correct** and is verified by the same
probe run as BBB and Downdetector, not assumed.

**Seeded with one entry.** `"automotive"` is the only industry among the three existing
subjects that needs one. Fintech, telecom and health entries are not pre-populated: there is
no subject to justify them, and inventing them would be guessing at URL shapes for companies
that do not exist in this repository.

**Explicit, never inferred.** `industry` is an optional field on `buildSourcePlan`'s overrides
object, supplied by whoever authors the run — mirroring `domain`, which that function already
refuses to guess when the guess would be unsafe. Nothing here classifies a company's industry
automatically; that is an unsolved problem this spec does not pretend to solve.

### C. Hand-researched into existing plan files

Court records, independent measurement sites, and any regulator page more specific than the
industry index page from mechanism B all have no company-name-derivable URL at all. (Mechanism
B produces the generic per-industry search page; mechanism C is where a *particular*
investigation or docket for a *particular* subject gets added by hand, if one worth citing
exists.) They get researched and added to `plans/tesla-fsd.json`,
`plans/vercel.json` and `plans/claude.json` as concrete URLs — the same route the SEC 10-K and
the GitHub issue search already took.

For court records, **CourtListener rather than PACER**: free, no login, no per-page fee, no
registration wall. Same reasoning that made GitHub issues the readable equivalent of Reddit —
prefer the source that answers a browser.

**Only where a real one exists.** If Vercel or Claude has no specific, relevant benchmark
aggregator or docket worth citing, none is invented to fill the slot. An empty slot is honest;
a fabricated one is the failure this whole tool exists to expose.

## Architecture

### New file — `src/sources/regulators.ts`

`src/sources/plan.ts` is ~130 lines with one clear job. The regulator lookup is a separate
concern — a data table plus a pure lookup — and gets its own focused file, imported by
`plan.ts`.

```ts
/** Industry → the regulator index page worth reading for a vendor in it. */
export type Industry = "automotive"

export function regulatorTargets(industry: Industry, subject: string): SourceTarget[]
```

Returns an array so an industry can grow to more than one regulator without changing the
signature.

`Industry` is a union with one member today, so the type system — not a runtime check —
is what stops an unrecognised industry reaching the lookup. That is the right guard while the
union is small: a typo is a compile error rather than a silently missing source. The function
still returns `[]` rather than throwing when the union has a member the table has not yet
gained, which is the one case the types cannot catch and the one this project would rather
see as an absent source than as a failed run.

### `buildSourcePlan` changes

```ts
export function buildSourcePlan(
  subject: string,
  overrides: { domain?: string; industry?: Industry; extra?: SourceTarget[] } = {},
): SourcePlan
```

Regulator targets are appended alongside `overrides.extra`, before the existing URL-dedup
filter, so a regulator page that duplicates a hand-added one collapses rather than fetching
twice.

### `SourceKind` — unchanged

No new kinds. BBB and Downdetector are the shape `review_site` already covers for G2. The
regulator index page is the shape `status_page` already covers — `plans/tesla-fsd.json`
already files `nhtsa.gov/vehicle-safety/automated-vehicles-safety` that way. CourtListener is a
search index, the shape `forum` already covers for Hacker News. Seven kinds cover all six new
classes; adding taxonomy for a one-off does not pay for itself, and this codebase has rejected
that pattern before.

## Error handling

Nothing here changes fetch behaviour. A new target that is blocked, empty, or 404s reports as
a `not read` row with its reason, exactly as G2 and Reddit already do. That is the existing
invariant and the reason adding a speculative source is cheap: a bad guess is visible in the
report rather than silent.

## Testing

- `regulatorTargets` is pure — table tests: a known industry returns targets whose URLs contain
  the subject; an unknown one returns `[]`; the returned targets carry `role: "independent"`,
  since a regulator is never the claimant.
- `buildSourcePlan` gains cases for the new defaults and for `industry` being passed and
  omitted, beside its existing tests.
- The probe run is the only step that spends money.

## Definition of done

- BBB and Downdetector are in `buildSourcePlan`'s defaults **only if** the probe showed them
  readable; if blocked, that result is recorded and they are left out.
- `regulatorTargets` exists, is tested, is seeded with `automotive` only, and its NHTSA URL
  shape was verified by a real fetch rather than assumed.
- Each of the three plan files carries the hand-researched additions that genuinely exist for
  its subject, and no invented ones.
- No new `SourceKind` values.
- The probe's actual results — including any source that turned out blocked — are recorded,
  not just the ones that worked.
