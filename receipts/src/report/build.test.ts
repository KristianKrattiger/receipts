import { describe, expect, it } from "vitest"
import { buildReport, rowStatus } from "./build.js"
import type { AdmitResult } from "../bookkeeper/admit.js"
import type { AdmittedSpan, Corpus, RelationProposal } from "../types.js"

const CORPUS: Corpus = {
  subject: "acme",
  docs: [{
    docId: "vendor", url: "https://acme.com", label: "Acme site",
    role: "vendor_claim", kind: "vendor_site",
    fetchedAt: "2026-08-31T00:00:00.000Z", title: "Acme",
    text: "text", sessionId: "s1",
  }],
  failures: [{ url: "https://g2.com/acme", label: "G2", reason: "captcha", detail: "blocked" }],
}

const SPAN: AdmittedSpan = { docId: "vendor", start: 0, end: 4, text: "text", tag: "EXACT" }

function rel(type: RelationProposal["type"], topic: string) {
  return {
    proposal: {
      proposalId: `p-${topic}`, type, topic, statement: `${topic} claim`,
      from: { docId: "vendor", quote: "text" }, to: null,
      rationale: "", confidence: 0.9,
    } satisfies RelationProposal,
    sides: [SPAN],
  }
}

describe("rowStatus", () => {
  it("maps contradicts and updates to divergent", () => {
    expect(rowStatus("contradicts")).toBe("divergent")
    expect(rowStatus("updates")).toBe("divergent")
  })
  it("maps corroborates to corroborated", () => {
    expect(rowStatus("corroborates")).toBe("corroborated")
  })
  it("maps unsupported to unverified", () => {
    expect(rowStatus("unsupported")).toBe("unverified")
  })
})

describe("buildReport", () => {
  const result: AdmitResult = {
    admitted: [rel("corroborates", "billing"), rel("unsupported", "support"), rel("contradicts", "uptime")],
    denied: [{ proposalId: "p9", code: "ANCHOR_NOT_FOUND" }],
  }

  it("orders divergent rows first, then unverified, then corroborated", () => {
    expect(buildReport(CORPUS, 4, result).rows.map((r) => r.status))
      .toEqual(["divergent", "unverified", "corroborated"])
  })

  it("records the admission audit", () => {
    const report = buildReport(CORPUS, 4, result)
    expect(report.audit).toEqual({ proposed: 4, admitted: 3, denied: result.denied })
  })

  it("carries source failures through to the report", () => {
    expect(buildReport(CORPUS, 4, result).failures[0]!.reason).toBe("captcha")
  })

  it("summarizes documents without copying their text", () => {
    const summary = buildReport(CORPUS, 4, result).docs[0]!
    expect(summary.label).toBe("Acme site")
    expect(summary).not.toHaveProperty("text")
  })

  it("produces a valid report with no admitted rows", () => {
    const empty = buildReport(CORPUS, 2, { admitted: [], denied: [] })
    expect(empty.rows).toEqual([])
    expect(empty.audit.admitted).toBe(0)
  })
})
