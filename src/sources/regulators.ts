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

/**
 * Pure: the regulator index pages worth reading for a vendor in this industry.
 *
 * Returns `[]` for an industry the table has no entry for, which today is every
 * industry -- see the note on REGULATORS. Under `Partial<Record<...>>` this is a
 * normal typed case rather than a defensive one, and returning `[]` rather than
 * throwing keeps the invariant that one absent source never fails a whole run.
 */
export function regulatorTargets(industry: Industry, subject: string): SourceTarget[] {
  return REGULATORS[industry]?.(subject) ?? []
}
