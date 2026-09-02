import { describe, expect, it } from "vitest"
import { analyzeCorpus } from "./pipeline.js"
import type { ProposalClient } from "./cartographer/propose.js"
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
    beta: {
      messages: {
        parse: async () => ({ stop_reason: "end_turn", parsed_output: { proposals } }) as never,
      },
    },
  }
}

describe("analyzeCorpus", () => {
  it("produces a divergent row from a well-anchored contradiction", async () => {
    const report = await analyzeCorpus(CORPUS, {
      client: client([{
        type: "contradicts", topic: "uptime", statement: "uptime guarantee",
        from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
        to: { docId: "status", quote: "four uptime incidents" },
        rationale: "contradiction", confidence: 0.9,
      }]),
    })
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]!.status).toBe("divergent")
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
    expect(report.rows).toEqual([])
    expect(report.audit.denied[0]!.code).toBe("ANCHOR_NOT_FOUND")
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
    const byId = new Map(CORPUS.docs.map((d) => [d.docId, d]))
    for (const row of report.rows) {
      for (const span of row.sides) {
        expect(byId.get(span.docId)!.text.slice(span.start, span.end)).toBe(span.text)
      }
    }
  })
})
