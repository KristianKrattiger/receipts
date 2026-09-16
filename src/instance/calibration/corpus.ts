import type { PinnedCorpus, PinnedDoc } from "../../assay/types.js"

export const SUBJECT = "Acme uptime"

function doc(docId: string, role: PinnedDoc["role"], text: string): PinnedDoc {
  return {
    docId, url: `https://example.test/${docId}`, label: docId, role, kind: role === "claimant" ? "vendor_site" : "forum",
    fetchedAt: "2026-09-15T00:00:00.000Z", title: docId, text, stability: "volatile",
    pin: { kind: "hash", sha256: docId.padEnd(64, "0") }, driftHash: "00",
  }
}

/** The vendor page: one true claim and one false one about the same product. */
export const CLAIM = doc("vendor", "claimant",
  "Acme uptime is 99.99% across every region.\n\nAcme uptime failover completes in under one second.")

/** A reviewer committing to its own measurement — a web "holding". */
export const REVIEWER = doc("reviewer", "independent",
  "We measured Acme uptime at 99.99% over ninety days across four regions.\n\nIn our tests Acme uptime failover took eleven seconds.")

/** A tester phrasing its own measurement as "according to our testing" — a holding, not hearsay. */
export const TESTER = doc("tester", "independent",
  "According to our testing, Acme uptime failover took eleven seconds.")

/** A forum poster, unmarked: no commitment marker. */
export const FORUM = doc("forum", "independent",
  "Acme uptime has been fine for me, basically 99.99% since I switched.")

/** Hearsay: an aggregator attributing a claim to others. */
export const AGGREGATOR = doc("aggregator", "independent",
  "Critics say Acme uptime failover is much slower than advertised.")

export function goldCorpus(independents: PinnedDoc[]): PinnedCorpus {
  return { subject: SUBJECT, docs: [CLAIM, ...independents], failures: [] }
}
