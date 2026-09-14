import { describe, expect, it } from "vitest"
import { renderHtml } from "./html.js"
import { renderMarkdown } from "./markdown.js"
import { renderTerminal } from "./terminal.js"
import type { Report } from "../../types.js"
import type { Refusal } from "../../assay/types.js"

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

function ledgerFixture(): Report {
  return REPORT
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

describe("renderers surface context_unverified", () => {
  const mixed: Report = {
    ...REPORT,
    rows: [
      REPORT.rows[0]!,
      REPORT.rows[1]!,
      {
        topic: "context",
        statement: "unmarked independent quote",
        status: "context_unverified",
        relation: "corroborates",
        sides: [{ docId: "status", start: 0, end: 4, text: "said", tag: "EXACT" }],
      },
      {
        topic: "billing",
        statement: "price is ten",
        status: "corroborated",
        relation: "corroborates",
        sides: [{ docId: "status", start: 0, end: 4, text: "ten", tag: "EXACT" }],
      },
    ],
  }

  it("renders a heading for context_unverified rows", () => {
    expect(renderMarkdown(mixed)).toMatch(/Context unverified/i)
    expect(renderTerminal(mixed)).toMatch(/CONTEXT UNVERIFIED/)
    expect(renderHtml(mixed)).toMatch(/Context unverified/i)
  })

  it("places that section between unverified and corroborated", () => {
    const md = renderMarkdown(mixed)
    const unverified = md.indexOf("## Unverified")
    const context = md.indexOf("## Context unverified")
    const corroborated = md.indexOf("## Corroborated")
    expect(unverified).toBeGreaterThan(-1)
    expect(context).toBeGreaterThan(unverified)
    expect(corroborated).toBeGreaterThan(context)
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

describe("renderers mark API-read sources", () => {
  const apiReport = {
    subject: "acme",
    generatedAt: "2026-09-05T00:00:00.000Z",
    docs: [{
      docId: "d1", url: "https://www.reddit.com/r/x/search/?q=acme", label: "Reddit - r/x",
      role: "independent" as const, fetchedAt: "2026-09-05T00:00:00.000Z", via: "api" as const,
    }],
    failures: [],
    rows: [],
    audit: { proposed: 0, admitted: 0, denied: [] },
  }

  it("terminal names the provenance in the sources listing", () => {
    expect(renderTerminal(apiReport)).toContain("(via api)")
  })

  it("markdown names the provenance in the sources listing", () => {
    expect(renderMarkdown(apiReport)).toContain("(via api)")
  })

})

const refusal: Refusal = {
  outcome: "refusal", subject: "Acme", generatedAt: "2026-09-09T00:00:00.000Z",
  reason: "CORPUS_INSUFFICIENT",
  detail: "only claimant sources were read; nothing was present that could contradict anything",
  docs: [], failures: [{ url: "u", label: "G2", reason: "blocked", detail: "no" }],
  nearMiss: [{ confidence: 0.42, statement: "0.42 — pricing: unlimited support included" }],
  audit: {
    proposed: 3, admitted: 0, denied: [],
    claimantChunks: 0, claimantCovered: 0, claimantOmitted: 0, claimantOmittedPreviews: [],
    independentDocsTotal: 0, independentDocsAdmitted: 0, issueStatementDenied: 0, contextUnverified: 0,
  },
}

describe("rendering a refusal", () => {
  it("terminal names the reason and the detail", () => {
    const out = renderTerminal(refusal)
    expect(out).toContain("REFUSED")
    expect(out).toContain("CORPUS_INSUFFICIENT")
    expect(out).toContain("nothing was present that could contradict anything")
  })

  it("terminal still lists the sources that could not be read", () => {
    expect(renderTerminal(refusal)).toContain("G2")
  })

  // Admission.detail (admit.ts) already opens with the confidence number, so a
  // renderer that also prints `confidence.toFixed(2)` beside the raw statement
  // would show the score twice. Assert the exact line, not just that "0.42"
  // appears somewhere — that would pass against the doubled-prefix bug too.
  it("terminal prints the near-miss confidence once, not doubled with the statement's own prefix", () => {
    const out = renderTerminal(refusal)
    expect(out).toContain("0.42  pricing: unlimited support included")
    expect(out).not.toContain("0.42  0.42")
  })

  it("markdown names the reason", () => {
    expect(renderMarkdown(refusal)).toContain("CORPUS_INSUFFICIENT")
  })

  it("markdown prints the near-miss confidence once, not doubled with the statement's own prefix", () => {
    const out = renderMarkdown(refusal)
    expect(out).toContain("`0.42` pricing: unlimited support included")
    expect(out).not.toContain("0.42` 0.42")
  })

  it("html names the reason and escapes it", () => {
    expect(renderHtml(refusal)).toContain("CORPUS_INSUFFICIENT")
  })

  it("html prints the near-miss confidence once, not doubled with the statement's own prefix", () => {
    const out = renderHtml(refusal)
    expect(out).toContain(">0.42</code> pricing: unlimited support included")
    expect(out).not.toContain("0.42</code> 0.42")
  })

  // The reason code itself never carries markup, but detail is free text off a
  // Refusal a caller could build from anything. It must be escaped exactly the
  // way every other free-text field on this page already is.
  it("html escapes the reason and detail like every other value on the page", () => {
    const hostile: Refusal = { ...refusal, detail: "<script>alert(1)</script>" }
    const out = renderHtml(hostile)
    expect(out).not.toContain("<script>alert(1)</script>")
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
  })

  it("a legacy report with no outcome field still renders as a ledger", () => {
    const legacy = { ...ledgerFixture() } as Record<string, unknown>
    delete legacy.outcome
    expect(renderTerminal(legacy as never)).not.toContain("REFUSED")
  })
})

describe("renderers — row provenance", () => {
  it("prints nothing extra when no row carries class", () => {
    expect(renderTerminal(REPORT)).not.toContain("provenance:")
    expect(renderTerminal(REPORT)).not.toContain("provisional")
    expect(renderMarkdown(REPORT)).not.toContain("provenance:")
    expect(renderHtml(REPORT)).not.toContain("provenance:")
    expect(renderHtml(REPORT)).not.toContain("class=\"prov\"")
  })

  it("prints class on the claim line and a provenance footer when stamped", () => {
    const stamped: Report = {
      ...REPORT,
      rows: [
        { ...REPORT.rows[0]!, provenance: { class: "provisional", reasons: ["volatile-source", "single-proposer-run"] } },
        { ...REPORT.rows[1]!, provenance: { class: "stable", reasons: [] } },
      ],
    }
    const terminal = renderTerminal(stamped)
    expect(terminal).toContain("[uptime]  provisional")
    expect(terminal).toContain("[support]  stable")
    expect(terminal).toContain("provenance: 1 stable · 1 provisional (1 volatile-source, 1 single-proposer-run)")

    const md = renderMarkdown(stamped)
    expect(md).toContain("_provisional_")
    expect(md).toContain("_stable_")
    expect(md).toContain("provenance: 1 stable · 1 provisional (1 volatile-source, 1 single-proposer-run)")

    const html = renderHtml(stamped)
    expect(html).toContain('<span class="prov">provisional</span>')
    expect(html).toContain("provenance: 1 stable · 1 provisional")
  })

  it("appends run disagreement on the footer when the audit says so", () => {
    const stamped: Report = {
      ...REPORT,
      rows: [{ ...REPORT.rows[0]!, provenance: { class: "provisional", reasons: [] } }],
      audit: { ...REPORT.audit, runDisagreement: true },
    }
    expect(renderTerminal(stamped)).toContain("provenance: 0 stable · 1 provisional · run disagreement")
  })
})
