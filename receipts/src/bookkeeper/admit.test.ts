import { describe, expect, it } from "vitest"
import { admit } from "./admit.js"
import { buildIdf, tokenize } from "../retrieve/idf.js"
import type { Corpus, FetchedDoc, RelationProposal } from "../types.js"

function doc(docId: string, role: FetchedDoc["role"], text: string): FetchedDoc {
  return {
    docId, url: `https://example.com/${docId}`, label: docId, role,
    kind: role === "vendor_claim" ? "vendor_site" : "status_page",
    fetchedAt: "2026-08-31T00:00:00.000Z", title: docId, text, sessionId: "s1",
  }
}

const VENDOR = doc("vendor", "vendor_claim",
  "Acme guarantees 99.99% uptime for every workspace on a paid plan.")
const STATUS = doc("status", "independent",
  "Acme reported four separate uptime incidents in the last ninety days.")

const CORPUS: Corpus = { subject: "acme", docs: [VENDOR, STATUS], failures: [] }
const TERMS = tokenize("acme uptime")
const IDF = buildIdf(CORPUS.docs)

function proposal(over: Partial<RelationProposal> = {}): RelationProposal {
  return {
    proposalId: "p0", type: "contradicts", topic: "uptime",
    statement: "uptime guarantee",
    from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
    to: { docId: "status", quote: "four separate uptime incidents" },
    rationale: "the status page contradicts the guarantee",
    confidence: 0.9,
    ...over,
  }
}

describe("admit — accepts sound proposals", () => {
  it("admits a well-anchored contradiction and assigns sides by role", () => {
    const r = admit(CORPUS, [proposal()], TERMS, IDF)
    expect(r.denied).toEqual([])
    expect(r.admitted).toHaveLength(1)
    const a = r.admitted[0]!
    expect(a.vendorSide!.docId).toBe("vendor")
    expect(a.independentSide!.docId).toBe("status")
  })

  it("re-derives offsets that round-trip against the source", () => {
    const a = admit(CORPUS, [proposal()], TERMS, IDF).admitted[0]!
    expect(VENDOR.text.slice(a.vendorSide!.start, a.vendorSide!.end)).toBe(a.vendorSide!.text)
    expect(STATUS.text.slice(a.independentSide!.start, a.independentSide!.end))
      .toBe(a.independentSide!.text)
  })

  it("admits a one-sided unsupported claim", () => {
    const r = admit(CORPUS, [proposal({ type: "unsupported", to: null })], TERMS, IDF)
    expect(r.admitted).toHaveLength(1)
    expect(r.admitted[0]!.independentSide).toBeNull()
  })
})

describe("admit — denies unsound proposals", () => {
  const cases: [string, Partial<RelationProposal>, string][] = [
    ["a fabricated quote", { from: { docId: "vendor", quote: "Acme promises perfect uptime" } }, "ANCHOR_NOT_FOUND"],
    ["an unknown document", { from: { docId: "ghost", quote: "anything" } }, "DOC_UNKNOWN"],
    ["a pair whose sides are the same document", { to: { docId: "vendor", quote: "every workspace" } }, "SELF_PAIR"],
    ["a low-confidence proposal", { confidence: 0.2 }, "LOW_CONFIDENCE"],
  ]

  for (const [name, over, code] of cases) {
    it(`denies ${name} with ${code}`, () => {
      const r = admit(CORPUS, [proposal(over)], TERMS, IDF)
      expect(r.admitted).toEqual([])
      expect(r.denied[0]!.code).toBe(code)
    })
  }

  it("denies a repeat of an already-admitted pair", () => {
    const r = admit(CORPUS, [proposal(), proposal({ proposalId: "p1" })], TERMS, IDF)
    expect(r.admitted).toHaveLength(1)
    expect(r.denied[0]!.code).toBe("DUPLICATE")
  })

  it("denies an off-topic pair", () => {
    const offTopic: Corpus = {
      subject: "acme",
      docs: [
        doc("vendor", "vendor_claim", "Our office kitchen restocks oat milk every Tuesday."),
        doc("status", "independent", "The oat milk ran out on a Wednesday last quarter."),
      ],
      failures: [],
    }
    const r = admit(
      offTopic,
      [proposal({
        from: { docId: "vendor", quote: "restocks oat milk every Tuesday" },
        to: { docId: "status", quote: "oat milk ran out on a Wednesday" },
      })],
      TERMS,
      buildIdf(offTopic.docs),
    )
    expect(r.denied[0]!.code).toBe("NOT_QUERY_RELEVANT")
  })
})

describe("admit — the standing invariant", () => {
  it("never admits a span absent from the source text", () => {
    const proposals: RelationProposal[] = Array.from({ length: 200 }, (_, i) => {
      const fabricate = i % 2 === 0
      return proposal({
        proposalId: `p${i}`,
        confidence: 0.5 + (i % 5) / 10,
        from: {
          docId: i % 7 === 0 ? "ghost" : "vendor",
          quote: fabricate ? `invented phrase ${i}` : "Acme guarantees 99.99% uptime",
        },
        to: {
          docId: "status",
          quote: fabricate ? `also invented ${i}` : "four separate uptime incidents",
        },
      })
    })

    const byId = new Map(CORPUS.docs.map((d) => [d.docId, d]))
    for (const a of admit(CORPUS, proposals, TERMS, IDF).admitted) {
      for (const span of [a.vendorSide, a.independentSide]) {
        if (!span) continue
        expect(byId.get(span.docId)!.text.slice(span.start, span.end)).toBe(span.text)
      }
    }
  })
})
