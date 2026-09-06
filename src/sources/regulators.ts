import type { SourceTarget } from "../types.js"

/**
 * Industries this project has probed a regulator for, as a value rather than a
 * bare type.
 *
 * A CLI flag, an MCP argument and a query string all carry a string that must
 * be checked at runtime, so the union alone is not enough -- and two lists that
 * can drift are worse than one. The type is derived from the array, so adding a
 * member here is the whole change.
 *
 * `automotive` stays in the list while its table entry is empty: the union
 * records the industries this project has *looked at*, and dropping it would
 * lose the measurement that NHTSA is not name-derivable.
 */
export const INDUSTRIES = ["automotive", "fintech"] as const

export type Industry = (typeof INDUSTRIES)[number]

/**
 * Pure: narrow a caller-supplied string to a known industry.
 *
 * Callers take this from argv, a tool argument or a query string, none of
 * which the compiler checks. Refusing an unknown name is the difference
 * between "receipts: unknown industry" and a silently absent source.
 */
export function isIndustry(value: string): value is Industry {
  return (INDUSTRIES as readonly string[]).includes(value)
}

/**
 * What a lookup table can honestly hold for a regulator.
 *
 * Not a document. The SEC filing in `plans/tesla-fsd.json` is
 * `.../edgar/data/1318605/000162828025003063/tsla-20241231.htm` -- a specific
 * CIK and accession number, hand-found, and no slug produces it. Regulator
 * dockets are not shaped like `g2.com/products/<slug>/reviews`.
 *
 * So this holds a per-industry *query*, parameterised by the vendor's name and
 * read as-is -- the same shape the Hacker News entry in `buildSourcePlan`
 * already uses. That shape only earns a place when the regulator's own index
 * is keyed by a name a caller can supply, which is the whole of why
 * `automotive` is empty and `fintech` is not.
 *
 * An earlier version of this comment guessed the yield would be "probably
 * lower than a hand-found filing -- a listing of recall titles and dates is
 * not the quotable substance a 10-K's own text carries". That guess predates
 * having an entry to measure, and CFPB refutes it: the complaints come back as
 * dated first-person narrative, which is more quotable than a recall listing,
 * not less. The guess was reasonable and wrong, which is the reason this table
 * takes measurements rather than expectations.
 */
const REGULATORS: Partial<Record<Industry, (subject: string) => SourceTarget[]>> = {
  // Probed 2026-09-06 against "Chime": 14,372 complaints, of which the API's
  // own aggregation attributes 13,949 to Chime Financial Inc. At this size=10,
  // all ten rows in fixtures/probe-cfpb.json name that company and no other;
  // a size=25 spot check was likewise 25 of 25. Narratives run ~3,000
  // characters of dated, quotable, first-person account.
  //
  // Three properties of this URL are load-bearing and all three fail silently:
  //   - the trailing slash before `?`, or the site serves its HTML search page
  //   - no `format=json`, which makes the endpoint answer 404
  //   - no `sort=`, because sorting by date discards relevance and returns
  //     complaints against other companies that merely mention the subject
  //
  // `no_aggs=true` drops a facet block worth ~33,000 characters that no
  // reader quotes. Size 10 is ~24,000 characters of narrative; 25 is ~60,000,
  // which buys more of the same rather than more coverage.
  fintech: (subject) => [
    {
      kind: "review_site",
      role: "independent",
      url: "https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/"
        + `?search_term=${encodeURIComponent(subject)}&size=10&no_aggs=true`,
      label: `CFPB complaints — ${subject}`,
    },
  ],

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
}

/**
 * Pure: the regulator index pages worth reading for a vendor in this industry.
 *
 * Returns `[]` for an industry the table has no entry for -- `automotive`
 * today, and see the note on REGULATORS for why. Under `Partial<Record<...>>`
 * that is a normal typed case rather than a defensive one, and returning `[]`
 * rather than throwing keeps the invariant that one absent source never fails
 * a whole run.
 */
export function regulatorTargets(industry: Industry, subject: string): SourceTarget[] {
  return REGULATORS[industry]?.(subject) ?? []
}
