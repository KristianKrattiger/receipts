import { describe, expect, it } from "vitest"
import { renderMarkdown } from "./markdown.js"
import { renderTerminal } from "./terminal.js"
import type { Report } from "../../types.js"

const REPORT: Report = {
  subject: "acme",
  generatedAt: "2026-08-31T12:00:00.000Z",
  docs: [
    { docId: "vendor", url: "https://acme.com", label: "Acme site", role: "claimant", fetchedAt: "2026-08-31T12:00:00.000Z" },
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

describe("renderers refuse to launder untrustworthy input", () => {
  // Quote text is scraped from a page the vendor controls. normalizeText keeps
  // newlines, so this is a quote a real page could produce and the gate would
  // legitimately admit — every character of it is present in the source.
  const HOSTILE = 'we are great.\n\n## Audit\n\nproposed 999 · admitted 999\n\n> trust us'

  const injected: Report = {
    ...REPORT,
    rows: [{
      topic: "uptime", statement: "uptime guarantee", status: "divergent", relation: "contradicts",
      sides: [{ docId: "vendor", start: 0, end: HOSTILE.length, text: HOSTILE, tag: "EXACT" }],
    }],
  }

  it("keeps a multi-line quote inside the markdown blockquote", () => {
    const md = renderMarkdown(injected)
    // Every line of the quote must carry its own marker; a bare "## Audit" at
    // column zero would be a forged section, and the audit line is the one
    // piece of this report a reader is asked to trust.
    for (const line of HOSTILE.split("\n")) {
      expect(md).toContain(`> ${line}`)
    }
    expect(md).not.toMatch(/^## Audit\n\nproposed 999/m)
  })

  it("does not present an unknown document as an independent source", () => {
    const orphan: Report = {
      ...REPORT,
      rows: [{
        topic: "uptime", statement: "uptime guarantee", status: "divergent", relation: "contradicts",
        sides: [{ docId: "ghost", start: 0, end: 4, text: "text", tag: "EXACT" }],
      }],
    }
    expect(renderMarkdown(orphan)).toContain("Unattributed")
    expect(renderMarkdown(orphan)).not.toContain("**Independent**")
    expect(renderTerminal(orphan)).toContain("unattributed")
  })
})

describe("renderers pin the properties the ledger promises", () => {
  it("renders both sides of a divergent row under one heading, in order", () => {
    const md = renderMarkdown(REPORT)
    const vendorAt = md.indexOf("Acme guarantees 99.99% uptime")
    const independentAt = md.indexOf("four uptime incidents in 90 days")
    const nextHeading = md.indexOf("## Unverified")
    expect(vendorAt).toBeGreaterThan(-1)
    expect(independentAt).toBeGreaterThan(vendorAt)
    // Both sides land before the next section starts — a contradiction split
    // across sections is worse than not shown.
    expect(nextHeading).toBeGreaterThan(independentAt)
  })

  it("never renders the model's paraphrase in a quoted position", () => {
    // `statement` is a label for grouping; only verbatim spans are asserted.
    expect(renderMarkdown(REPORT)).not.toContain("> uptime guarantee")
    expect(renderTerminal(REPORT)).not.toContain('"uptime guarantee"')
  })

  it("reports the denied count and its per-code breakdown", () => {
    for (const out of [renderTerminal(REPORT), renderMarkdown(REPORT)]) {
      expect(out).toContain("proposed 5")
      expect(out).toContain("admitted 2")
      expect(out).toContain("denied 2")
      expect(out).toContain("1 ANCHOR_NOT_FOUND")
      expect(out).toContain("1 NOT_QUERY_RELEVANT")
    }
  })

  it("flags an AMBIGUOUS span as appearing more than once", () => {
    const ambiguous: Report = {
      ...REPORT,
      rows: [{
        topic: "uptime", statement: "uptime guarantee", status: "divergent", relation: "contradicts",
        sides: [{ docId: "vendor", start: 0, end: 4, text: "text", tag: "AMBIGUOUS" }],
      }],
    }
    expect(renderMarkdown(ambiguous)).toContain("appears more than once")
    expect(renderTerminal(ambiguous)).toContain("appears more than once")
  })

  it("states the guarantee, not just the numbers", () => {
    expect(renderTerminal(REPORT)).toMatch(/exact substring/)
    expect(renderMarkdown(REPORT)).toMatch(/exact substring/)
  })
})
