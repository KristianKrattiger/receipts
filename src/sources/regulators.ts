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
 * The `?? []` is not what catches a missing table entry -- `REGULATORS` is a
 * `Record<Industry, ...>`, so a new member of the union makes that declaration
 * a compile error until the table gains a matching entry. TypeScript is the
 * guard, and it is a better one than a runtime default because it fails at the
 * point the mistake is made rather than as a silently absent source later.
 *
 * The fallback exists only for a caller that reaches this through an unsafe
 * cast or an `any`, where the types were never checked at all. Returning `[]`
 * there rather than throwing keeps the existing invariant that one absent
 * source never fails a whole run.
 */
export function regulatorTargets(industry: Industry, subject: string): SourceTarget[] {
  return REGULATORS[industry]?.(subject) ?? []
}
