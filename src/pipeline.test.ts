import { describe, expect, it } from "vitest"
import { analyzeCorpus } from "./pipeline.js"
import type { ProposalClient } from "./assay/cartographer/propose.js"
import type { Corpus, FetchedDoc } from "./types.js"

function doc(docId: string, role: FetchedDoc["role"], text: string): FetchedDoc {
  return {
    docId, url: `https://example.com/${docId}`, label: docId, role,
    kind: role === "claimant" ? "vendor_site" : "status_page",
    fetchedAt: "2026-08-31T00:00:00.000Z", title: docId, text, sessionId: "s1",
  }
}

const CORPUS: Corpus = {
  subject: "acme",
  docs: [
    doc("vendor", "claimant", "Acme guarantees 99.99% uptime for every acme workspace."),
    doc("status", "independent", "Acme logged four uptime incidents across ninety days."),
  ],
  failures: [],
}

function client(proposals: unknown[]): ProposalClient {
  return {
    propose: async () => ({ proposals: proposals as never, stopReason: "end_turn" }),
  }
}

describe("analyzeCorpus", () => {
  it("produces a disputed row from a well-anchored but unmarked contradiction", async () => {
    const report = await analyzeCorpus(CORPUS, {
      client: client([{
        type: "contradicts", topic: "uptime", statement: "uptime guarantee",
        from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
        to: { docId: "status", quote: "four uptime incidents" },
        rationale: "contradiction", confidence: 0.9,
      }]),
    })
    expect(report.outcome).toBe("ledger")
    if (report.outcome !== "ledger") throw new Error("expected a ledger")
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]!.status).toBe("disputed")
    expect(report.audit.admitted).toBe(1)
  })

  it("denies a fabricated quote end to end", async () => {
    const report = await analyzeCorpus(CORPUS, {
      client: client([{
        type: "contradicts", topic: "uptime", statement: "uptime guarantee",
        from: { docId: "vendor", quote: "Acme promises flawless uptime" },
        to: { docId: "status", quote: "four uptime incidents" },
        rationale: "contradiction", confidence: 0.9,
      }]),
    })
    // Nothing anchored, so the ledger never forms: the run refuses for want of
    // grounding, and the fabricated quote is on the audit as ANCHOR_NOT_FOUND.
    expect(report.outcome).toBe("refusal")
    if (report.outcome !== "refusal") throw new Error("expected a refusal")
    expect(report.reason).toBe("NO_GROUNDING")
    expect(report.audit.denied.some((d) => d.code === "ANCHOR_NOT_FOUND")).toBe(true)
  })

  it("upholds the standing invariant on every admitted span", async () => {
    const report = await analyzeCorpus(CORPUS, {
      client: client([{
        type: "contradicts", topic: "uptime", statement: "uptime guarantee",
        from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
        to: { docId: "status", quote: "four uptime incidents" },
        rationale: "contradiction", confidence: 0.9,
      }]),
    })
    expect(report.outcome).toBe("ledger")
    if (report.outcome !== "ledger") throw new Error("expected a ledger")
    const byId = new Map(CORPUS.docs.map((d) => [d.docId, d]))
    for (const row of report.rows) {
      for (const span of row.sides) {
        expect(byId.get(span.docId)!.text.slice(span.start, span.end)).toBe(span.text)
      }
    }
  })
})

describe("analyzeCorpus — an outage is not a clean bill of health", () => {
  const failing: ProposalClient = {
    propose: async () => { throw new Error("credit balance is too low") },
  }

  // An expired key produced an empty report at exit 0, indistinguishable from
  // "nothing was found wrong with this vendor". That is the exact shape of
  // dishonesty this engine exists to prevent, arriving through the back door.
  it("refuses to build a report when every pass failed", async () => {
    await expect(analyzeCorpus(CORPUS, { client: failing }))
      .rejects.toThrow(/every proposal pass failed/)
  })

  it("names the underlying cause so the failure is actionable", async () => {
    await expect(analyzeCorpus(CORPUS, { client: failing }))
      .rejects.toThrow(/credit balance is too low/)
  })

  // Partial failure stays survivable: a thinner ledger, honestly labelled,
  // beats no ledger.
  it("still reports when only some passes failed", async () => {
    let call = 0
    const flaky: ProposalClient = {
      propose: async () => {
        call += 1
        if (call === 1) throw new Error("transient")
        return {
          proposals: [{
            type: "unsupported", topic: "uptime", statement: "uptime guarantee",
            from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
            to: null, rationale: "nothing corroborates", confidence: 0.9,
          }] as never,
          stopReason: "end_turn",
        }
      },
    }
    const report = await analyzeCorpus(CORPUS, { client: flaky })
    expect(report.outcome).toBe("ledger")
    if (report.outcome !== "ledger") throw new Error("expected a ledger")
    expect(report.rows.length).toBeGreaterThan(0)
  })
})
