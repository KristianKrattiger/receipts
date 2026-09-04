import { describe, expect, it } from "vitest"
import { corpusShape, formatStats, totals, yieldStats } from "./yield.js"
import type { Corpus, FetchedDoc, Report } from "../types.js"

function report(over: Partial<Report> = {}): Report {
  return {
    subject: "acme",
    generatedAt: "2026-09-04T00:00:00.000Z",
    docs: [
      { docId: "v1", url: "https://acme.com", label: "site", role: "claimant", fetchedAt: "x" },
      { docId: "v2", url: "https://acme.com/docs", label: "docs", role: "claimant", fetchedAt: "x" },
      { docId: "i1", url: "https://status.acme.com", label: "status", role: "independent", fetchedAt: "x" },
    ],
    failures: [],
    rows: [{
      topic: "uptime", statement: "uptime guarantee", status: "divergent", relation: "contradicts",
      sides: [
        { docId: "v1", start: 0, end: 5, text: "a", tag: "EXACT" },
        { docId: "i1", start: 0, end: 5, text: "b", tag: "EXACT" },
      ],
    }],
    audit: {
      proposed: 4,
      admitted: 1,
      denied: [
        { proposalId: "p1", code: "LOW_CONFIDENCE", detail: "0.45 — pricing: costs $9" },
        { proposalId: "p2", code: "LOW_CONFIDENCE", detail: "0.45 — scale: many users" },
        { proposalId: "p3", code: "DUPLICATE", detail: "claim:contradicts:v1@0" },
      ],
    },
    ...over,
  }
}

function doc(docId: string, role: FetchedDoc["role"], text: string): FetchedDoc {
  return {
    docId, url: `https://example.com/${docId}`, label: docId, role,
    kind: role === "claimant" ? "vendor_site" : "status_page",
    fetchedAt: "x", title: docId, text, sessionId: "s",
  }
}

describe("yieldStats", () => {
  it("reports the admit rate against what was proposed", () => {
    const s = yieldStats(report())
    expect(s.proposed).toBe(4)
    expect(s.admitted).toBe(1)
    expect(s.admitRate).toBe(0.25)
  })

  it("does not divide by zero when nothing was proposed", () => {
    const s = yieldStats(report({ audit: { proposed: 0, admitted: 0, denied: [] } }))
    expect(s.admitRate).toBe(0)
  })

  it("orders the denial mix by frequency", () => {
    expect(yieldStats(report()).denialMix).toEqual([["LOW_CONFIDENCE", 2], ["DUPLICATE", 1]])
  })

  // The measurement the plan turns on: a spike just under the floor is the
  // model hedging on an undefined scale, not two borderline findings.
  it("bins the confidence of low-confidence denials", () => {
    expect(yieldStats(report()).lowConfidence).toEqual([["0.45", 2]])
  })

  it("ignores a low-confidence denial whose detail carries no number", () => {
    const r = report({
      audit: { proposed: 1, admitted: 0, denied: [{ proposalId: "p1", code: "LOW_CONFIDENCE" }] },
    })
    expect(yieldStats(r).lowConfidence).toEqual([])
  })

  it("counts rows by status", () => {
    expect(yieldStats(report()).rowsByStatus).toEqual({ divergent: 1, corroborated: 0, unverified: 0 })
  })

  // A ledger whose every row traces back to one vendor page is one page away
  // from being empty, however many independent sources were read.
  it("counts how many claimant documents actually appear in rows", () => {
    const s = yieldStats(report())
    expect(s.claimantDocsRead).toBe(2)
    expect(s.claimantDocsCited).toBe(1)
  })

  it("does not count an independent document as a claimant citation", () => {
    const r = report({
      rows: [{
        topic: "t", statement: "s", status: "unverified", relation: "unsupported",
        sides: [{ docId: "i1", start: 0, end: 1, text: "a", tag: "EXACT" }],
      }],
    })
    expect(yieldStats(r).claimantDocsCited).toBe(0)
  })

  it("omits the corpus shape when no fixture was supplied", () => {
    expect(yieldStats(report()).corpus).toBeUndefined()
  })
})

describe("corpusShape", () => {
  const corpus: Corpus = {
    subject: "acme",
    docs: [doc("v1", "claimant", "x".repeat(100)), doc("i1", "independent", "y".repeat(8800))],
    failures: [],
  }

  it("splits characters by role and reports the imbalance", () => {
    const c = corpusShape(corpus)
    expect(c).toMatchObject({
      claimantDocs: 1, claimantChars: 100, independentDocs: 1, independentChars: 8800,
    })
    expect(c.ratio).toBe(88)
  })

  it("reports a ratio of zero rather than Infinity when no claimant was read", () => {
    const none: Corpus = { subject: "acme", docs: [doc("i1", "independent", "y")], failures: [] }
    expect(corpusShape(none).ratio).toBe(0)
  })
})

describe("totals", () => {
  it("sums across reports, which is the number the plan moves", () => {
    expect(totals([yieldStats(report()), yieldStats(report())]))
      .toEqual({ proposed: 8, admitted: 2, rows: 2 })
  })
})

describe("formatStats", () => {
  const out = formatStats(yieldStats(report()))

  it("leads with the subject and the admit rate", () => {
    expect(out).toContain("acme")
    expect(out).toContain("proposed 4 · admitted 1 (25%)")
  })

  it("omits the low-confidence line when there is nothing to show", () => {
    const clean = formatStats(yieldStats(report({ audit: { proposed: 1, admitted: 1, denied: [] } })))
    expect(clean).not.toContain("low conf")
    expect(clean).not.toContain("denied")
  })
})
