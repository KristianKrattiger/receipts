import type { SourcePlan, SourceTarget } from "../types.js"

export function slugify(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * Whether the ASCII slug preserves every letter and digit of the subject.
 *
 * Guessing a domain is only safe when it does. `slugify` drops anything outside
 * [a-z0-9], so "東京 Systems" slugs to "systems" and "Café Cloud" to "cafcloud"
 * — and `systems.com` is a real, registered, unrelated company. Fetching it
 * would file a stranger's marketing under this vendor's own claims, which is a
 * false attribution, not the "cheap and visible" bad guess the docstring below
 * promises. Punctuation and spaces are not letters, so "Acme, Inc." stays fine.
 */
function slugPreservesSubject(subject: string): boolean {
  const lower = subject.toLowerCase()
  const everyLetterOrDigit = (lower.match(/[\p{L}\p{N}]/gu) ?? []).join("")
  const asciiOnly = (lower.match(/[a-z0-9]/g) ?? []).join("")
  return everyLetterOrDigit === asciiOnly
}

/**
 * Resolve a vendor name to a set of pages worth reading.
 *
 * Deliberately boring: conventional URL patterns plus an override hook. Getting
 * this wrong is cheap and visible — a bad guess shows up as a source failure in
 * the report rather than as a silent gap.
 *
 * Forums are reached through their own public search endpoints, rather than the
 * browser fan-out, wherever such an endpoint exists.
 *
 * Throws when the subject's domain cannot be guessed safely; pass `domain`.
 */
export function buildSourcePlan(
  subject: string,
  overrides: { domain?: string; extra?: SourceTarget[] } = {},
): SourcePlan {
  const slug = slugify(subject)

  if (overrides.domain === undefined && !slugPreservesSubject(subject)) {
    throw new Error(
      `receipts: cannot guess a domain for ${JSON.stringify(subject)} — ` +
        `its name contains characters a hostname cannot carry, and the ASCII ` +
        `form (${JSON.stringify(slug || "<empty>")}) may belong to someone ` +
        `else. Pass the vendor's domain explicitly.`,
    )
  }

  const domain = overrides.domain ?? `${slug.replace(/-/g, "")}.com`

  // Forums are searched by domain, not by name. A vendor name is often a
  // common word: searching Hacker News for "solari" returns 11,873 results
  // about solar panels, airport flip-boards and a Bevy raytracer, and not one
  // about the company. The IDF relevance gate cannot rescue that — every one
  // of those results does contain the word — so the corpus fills with
  // confidently off-topic "independent sources". A domain is the one string
  // that identifies a vendor unambiguously.
  const q = encodeURIComponent(domain)

  const targets: SourceTarget[] = [
    { kind: "vendor_site", role: "vendor_claim", url: `https://${domain}`, label: `${subject} homepage` },
    { kind: "vendor_pricing", role: "vendor_claim", url: `https://${domain}/pricing`, label: `${subject} pricing` },
    { kind: "vendor_docs", role: "vendor_claim", url: `https://docs.${domain}`, label: `${subject} docs` },
    { kind: "status_page", role: "independent", url: `https://status.${domain}`, label: `${subject} status page` },
    { kind: "forum", role: "independent", url: `https://hn.algolia.com/?q=${q}`, label: "Hacker News" },
    { kind: "forum", role: "independent", url: `https://www.reddit.com/search/?q=${q}`, label: "Reddit" },
    { kind: "review_site", role: "independent", url: `https://www.g2.com/products/${slug}/reviews`, label: "G2 reviews" },
    ...(overrides.extra ?? []),
  ]

  const seen = new Set<string>()
  return {
    subject,
    targets: targets.filter((t) => (seen.has(t.url) ? false : (seen.add(t.url), true))),
  }
}
