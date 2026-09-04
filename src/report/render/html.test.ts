import { describe, expect, it } from "vitest"
import { renderHtml, renderIndex } from "./html.js"
import type { Report } from "../../types.js"

const REPORT: Report = {
  subject: "acme",
  generatedAt: "2026-08-31T12:00:00.000Z",
  docs: [{ docId: "vendor", url: "https://acme.com", label: "Acme site", role: "claimant", fetchedAt: "2026-08-31T12:00:00.000Z" }],
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

describe("renderIndex", () => {
  function entry(subject: string, name = "acme") {
    return { name, report: { ...REPORT, subject } }
  }

  it("escapes the subject, which the inlined index used to interpolate raw", () => {
    const html = renderIndex([entry('<img src=x onerror="alert(1)">')])
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("&lt;img")
  })

  it("escapes the file name in the link target", () => {
    const html = renderIndex([entry("acme", '"><script>')])
    expect(html).not.toContain('"><script>')
  })

  it("counts divergent and unverified rows per report", () => {
    expect(renderIndex([entry("acme")])).toMatch(/1 divergent, 0 unverified/)
  })

  it("emits a complete document", () => {
    const html = renderIndex([entry("acme")])
    expect(html.trimStart().startsWith("<!doctype html>")).toBe(true)
    expect(html.trimEnd().endsWith("</html>")).toBe(true)
  })
})

describe("renderHtml — attribution", () => {
  it("does not present an unknown document as an independent source", () => {
    const orphan: Report = {
      ...REPORT,
      rows: [{
        topic: "uptime", statement: "uptime guarantee", status: "divergent", relation: "contradicts",
        sides: [{ docId: "ghost", start: 0, end: 4, text: "text", tag: "EXACT" }],
      }],
    }
    const html = renderHtml(orphan)
    expect(html).toContain("Unattributed")
    expect(html).not.toContain("Independent —")
  })
})

describe("renderHtml — link safety", () => {
  function withUrl(url: string): Report {
    return {
      ...REPORT,
      docs: [{ docId: "vendor", url, label: "Acme site", role: "claimant", fetchedAt: "2026-08-31T12:00:00.000Z" }],
    }
  }

  // esc() neutralizes markup, not schemes. These would survive it untouched.
  for (const hostile of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)"]) {
    it(`refuses to make ${hostile.split(":")[0]}: a link target`, () => {
      const html = renderHtml(withUrl(hostile))
      expect(html).not.toContain(`href="${hostile}"`)
      expect(html).not.toMatch(/href="(?!https?:)/)
      // The url is still shown, just inert.
      expect(html).toContain("Acme site")
    })
  }

  it("still links an ordinary https source", () => {
    expect(renderHtml(withUrl("https://acme.com"))).toContain('href="https://acme.com"')
  })

  it("escapes a source label, which is a free string", () => {
    const html = renderHtml({
      ...REPORT,
      docs: [{ docId: "vendor", url: "https://acme.com", label: '<script>alert(1)</script>', role: "claimant", fetchedAt: "2026-08-31T12:00:00.000Z" }],
    })
    expect(html).not.toContain("<script>alert(1)</script>")
  })
})

describe("renderIndex — counts are per report", () => {
  it("does not pool rows across entries", () => {
    const oneDivergent = { ...REPORT }
    const noRows: Report = { ...REPORT, subject: "beta", rows: [] }
    const html = renderIndex([
      { name: "acme", report: oneDivergent },
      { name: "beta", report: noRows },
    ])
    expect(html).toMatch(/acme<\/a> — 1 divergent, 0 unverified/)
    expect(html).toMatch(/beta<\/a> — 0 divergent, 0 unverified/)
  })
})

describe("renderHtml — a verbatim quote cannot break the layout", () => {
  // A quote is copied byte-for-byte, so it can contain a bare URL with no
  // space in it. Without a wrap rule that one token sets the width of the
  // page: the Vercel ledger's breach-report citation rendered 511px wide in a
  // 375px viewport and scrolled every section sideways with it.
  it("lets a quote wrap mid-token when nothing else will break", () => {
    expect(renderHtml(REPORT)).toContain("overflow-wrap: anywhere")
  })
})
