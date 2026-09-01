import { describe, expect, it } from "vitest"
import { renderMarkdown } from "./markdown.js"
import { renderTerminal } from "./terminal.js"
import type { Report } from "../../types.js"

const REPORT: Report = {
  subject: "acme",
  generatedAt: "2026-08-31T12:00:00.000Z",
  docs: [
    { docId: "vendor", url: "https://acme.com", label: "Acme site", role: "vendor_claim", fetchedAt: "2026-08-31T12:00:00.000Z" },
    { docId: "status", url: "https://status.acme.com", label: "Status page", role: "independent", fetchedAt: "2026-08-31T12:00:00.000Z" },
  ],
  failures: [{ url: "https://g2.com/acme", label: "G2", reason: "captcha", detail: "challenge page" }],
  rows: [
    {
      topic: "uptime", statement: "uptime guarantee", status: "divergent", relation: "contradicts",
      sides: [
        { docId: "vendor", start: 0, end: 29, text: "Acme guarantees 99.99% uptime", tag: "EXACT" },
        { docId: "status", start: 5, end: 35, text: "four uptime incidents in 90 days", tag: "EXACT" },
      ],
    },
    {
      topic: "support", statement: "one hour response", status: "unverified", relation: "unsupported",
      sides: [{ docId: "vendor", start: 40, end: 60, text: "responds within one hour", tag: "EXACT" }],
    },
  ],
  audit: { proposed: 5, admitted: 2, denied: [
    { proposalId: "p3", code: "ANCHOR_NOT_FOUND" },
    { proposalId: "p4", code: "NOT_QUERY_RELEVANT" },
  ] },
}

for (const [name, render] of [["terminal", renderTerminal], ["markdown", renderMarkdown]] as const) {
  describe(`${name} renderer`, () => {
    const out = render(REPORT)

    it("renders both sides of a divergent row", () => {
      expect(out).toContain("Acme guarantees 99.99% uptime")
      expect(out).toContain("four uptime incidents in 90 days")
    })

    it("names the unverified claim", () => {
      expect(out).toContain("responds within one hour")
    })

    it("reports the admission audit", () => {
      expect(out).toMatch(/proposed 5/)
      expect(out).toMatch(/admitted 2/)
      expect(out).toContain("ANCHOR_NOT_FOUND")
    })

    it("names sources that could not be read", () => {
      expect(out).toContain("G2")
      expect(out).toContain("captcha")
    })

    it("attributes every quote to a source label", () => {
      expect(out).toContain("Acme site")
      expect(out).toContain("Status page")
    })
  })
}

describe("renderers on an empty ledger", () => {
  const empty: Report = { ...REPORT, rows: [], audit: { proposed: 0, admitted: 0, denied: [] } }

  it("says nothing was verified rather than rendering blank", () => {
    expect(renderTerminal(empty)).toMatch(/nothing/i)
    expect(renderMarkdown(empty)).toMatch(/nothing/i)
  })
})
