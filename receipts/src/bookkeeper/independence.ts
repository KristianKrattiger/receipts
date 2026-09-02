import type { Corpus } from "../types.js"

/**
 * Whether a span offered as independent is really the claimant talking.
 *
 * Role is a property of the *document*, so every result on an aggregator page
 * inherits "independent" from the page. That is wrong for the common case: a
 * Hacker News search for a vendor returns the vendor's own announcements, and
 * a span quoting `Claude Haiku 4.5(https://www.anthropic.com/news/...)` was
 * being admitted as third-party corroboration of a claim on anthropic.com.
 *
 * An aggregator is a conduit, not a source. A press release does not become
 * independent by being posted somewhere else, and a report that says it did is
 * doing the exact thing this tool exists to prevent.
 */

/** Approximate registrable domain: last two labels, `www.` stripped. */
export function registrableDomain(host: string): string {
  const clean = host.toLowerCase().replace(/^www\./, "")
  const labels = clean.split(".")
  // Good enough for the hosts a source plan names. It does not handle
  // multi-part suffixes like .co.uk, which would over-match to "co.uk" —
  // acceptable because both sides of a comparison are normalised the same way.
  return labels.length <= 2 ? clean : labels.slice(-2).join(".")
}

/** The domains the claimant speaks from, taken from its own documents. */
export function claimantDomains(corpus: Corpus): Set<string> {
  const domains = new Set<string>()
  for (const doc of corpus.docs) {
    if (doc.role !== "claimant") continue
    try {
      domains.add(registrableDomain(new URL(doc.url).hostname))
    } catch {
      // A source plan can carry anything; an unparseable url simply
      // contributes no domain rather than failing the run.
    }
  }
  return domains
}

/**
 * True when the text carries a URL pointing at the claimant.
 *
 * Deliberately a *link* check, not a mention check. An independent commenter
 * writing "anthropic.com was down for an hour" is genuine third-party
 * testimony and must still count; a result whose target is the claimant's own
 * page is the claimant's own words.
 */
export function citesClaimant(text: string, domains: Set<string>): boolean {
  if (domains.size === 0) return false
  for (const match of text.matchAll(/https?:\/\/([^\s/)"'<>]+)/gi)) {
    const host = match[1]
    if (host === undefined) continue
    if (domains.has(registrableDomain(host))) return true
  }
  return false
}
