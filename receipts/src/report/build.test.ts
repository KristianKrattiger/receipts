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

const SECOND_SPAN: AdmittedSpan = {
  docId: "status", start: 2, end: 4, text: "xt", tag: "AMBIGUOUS",
}

function rel(type: RelationProposal["type"], topic: string, sides: AdmittedSpan[] = [SPAN]) {
  return {
    proposal: {
      proposalId: `p-${topic}`, type, topic, statement: `${topic} claim`,
      from: { docId: "vendor", quote: "text" }, to: null,
      rationale: "", confidence: 0.9,
    } satisfies RelationProposal,
    sides,
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

  // The load-bearing contract: rows carry every validated span through
  // untouched. Role-keyed slots used to drop one silently, which is the whole
  // reason sides is a list — so the passthrough needs an assertion of its own.
  it("carries both sides and the row's own fields through unchanged", () => {
    const two = buildReport(CORPUS, 1, {
      admitted: [rel("contradicts", "uptime", [SPAN, SECOND_SPAN])],
      denied: [],
    })
    const row = two.rows[0]!
    expect(row.sides).toEqual([SPAN, SECOND_SPAN])
    expect(row.topic).toBe("uptime")
    expect(row.statement).toBe("uptime claim")
    expect(row.relation).toBe("contradicts")
  })

  // Equal status and equal topic make the comparator return 0; input order
  // must survive so a report built twice from one corpus is byte-identical.
  it("keeps input order for rows the comparator cannot distinguish", () => {
    const tied = buildReport(CORPUS, 2, {
      admitted: [
        rel("contradicts", "uptime", [SPAN]),
        rel("contradicts", "uptime", [SECOND_SPAN]),
      ],
      denied: [],
    })
    expect(tied.rows.map((r) => r.sides[0]!.docId)).toEqual(["vendor", "status"])
  })
})
