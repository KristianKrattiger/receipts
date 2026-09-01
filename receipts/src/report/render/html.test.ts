import { describe, expect, it } from "vitest"
import { renderHtml } from "./html.js"
import type { Report } from "../../types.js"

const REPORT: Report = {
  subject: "acme",
  generatedAt: "2026-08-31T12:00:00.000Z",
  docs: [{ docId: "vendor", url: "https://acme.com", label: "Acme site", role: "vendor_claim", fetchedAt: "2026-08-31T12:00:00.000Z" }],
  failures: [],
  rows: [{
    topic: "uptime", statement: "uptime guarantee", status: "divergent", relation: "contradicts",
    sides: [{ docId: "vendor", start: 0, end: 5, text: "<script>alert(1)</script>", tag: "EXACT" }],
  }],
  audit: { proposed: 2, admitted: 1, denied: [{ proposalId: "p1", code: "ANCHOR_NOT_FOUND" }] },
}

describe("renderHtml", () => {
  const html = renderHtml(REPORT)

  it("escapes quoted text so a scraped page cannot inject markup", () => {
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("includes the subject and the audit line", () => {
    expect(html).toContain("acme")
    expect(html).toContain("ANCHOR_NOT_FOUND")
  })

  it("emits a complete document", () => {
    expect(html.trimStart().startsWith("<!doctype html>")).toBe(true)
    expect(html.trimEnd().endsWith("</html>")).toBe(true)
  })

  it("links each source", () => {
    expect(html).toContain('href="https://acme.com"')
  })
})
