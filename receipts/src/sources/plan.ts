import type { SourcePlan, SourceTarget } from "../types.js"

export function slugify(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

/**
 * Resolve a vendor name to a set of pages worth reading.
 *
 * Deliberately boring: conventional URL patterns plus an override hook. Getting
 * this wrong is cheap and visible — a bad guess shows up as a source failure in
 * the report rather than as a silent gap.
 *
 * Forums are reached through their own public search endpoints rather than the
 * browser fan wherever one exists.
 */
export function buildSourcePlan(
  subject: string,
  overrides: { domain?: string; extra?: SourceTarget[] } = {},
): SourcePlan {
  const slug = slugify(subject)
  const domain = overrides.domain ?? `${slug.replace(/-/g, "")}.com`
  const q = encodeURIComponent(subject)

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
