import { describe, expect, it } from "vitest"
import { admit, admitContext, admitScreened, orderForAdmission, screen } from "./admit.js"
import { buildIdf, tokenize } from "../retrieve/idf.js"
import { TEST_PROFILE } from "../test-profile.js"
import type { PinnedCorpus, RelationProposal } from "../types.js"

function doc(docId: string, role: PinnedCorpus["docs"][number]["role"], text: string): PinnedCorpus["docs"][number] {
  return {
    docId, url: `https://example.com/${docId}`, label: docId, role,
    kind: role === "claimant" ? "vendor_site" : "status_page",
    fetchedAt: "2026-08-31T00:00:00.000Z", title: docId, text,
    stability: "volatile", pin: { kind: "hash", sha256: "00" }, driftHash: "00",
  }
}

const CORPUS: PinnedCorpus = {
  subject: "acme",
  docs: [
    doc("vendor", "claimant", "Acme guarantees 99.99% uptime for every workspace on a paid plan. Acme support answers within one hour."),
    doc("status", "independent", "Acme reported four separate uptime incidents in the last ninety days."),
  ],
  failures: [],
}
const TERMS = tokenize("acme uptime")
const IDF = buildIdf(CORPUS.docs)

function p(over: Partial<RelationProposal>): RelationProposal {
  return {
    proposalId: "p0", type: "contradicts", topic: "uptime", statement: "s",
    from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
    to: { docId: "status", quote: "four separate uptime incidents" },
    rationale: "r", confidence: 0.9, ...over,
  }
}

// A mix that exercises every branch: admitted, low confidence, unknown doc,
// unanchorable quote, a duplicate pair, an unsupported twin retired by the
// related-span rule, and an admitted unsupported claim.
const MIX: RelationProposal[] = [
  p({ proposalId: "u1", type: "unsupported", to: null }),
  p({ proposalId: "c1" }),
  p({ proposalId: "low", confidence: 0.1 }),
  p({ proposalId: "unk", to: { docId: "nope", quote: "x" } }),
  p({ proposalId: "gone", from: { docId: "vendor", quote: "Acme never said this" } }),
  p({ proposalId: "dup" }),
  p({ proposalId: "u2", type: "unsupported", to: null, from: { docId: "vendor", quote: "Acme support answers within one hour." } }),
]

describe("admit split", () => {
  it("screen then admitScreened reproduces admit() exactly, denials in the same order", () => {
    const whole = admit(CORPUS, MIX, TERMS, IDF, undefined, TEST_PROFILE.lexicon)
    const ctx = admitContext(CORPUS, TERMS, IDF, undefined, TEST_PROFILE.lexicon)
    const split = admitScreened(orderForAdmission(MIX).map((x) => screen(x, ctx)), ctx)
    expect(split).toEqual(whole)
    expect(whole.admitted.length).toBeGreaterThan(0)
    expect(whole.denied.map((d) => d.code)).toContain("DUPLICATE")
  })

  it("screen is per-proposal: the same proposal screens the same whatever else is in the batch", () => {
    const ctx = admitContext(CORPUS, TERMS, IDF, undefined, TEST_PROFILE.lexicon)
    const alone = screen(p({ proposalId: "dup" }), ctx)
    expect(alone.ok).toBe(true)
    const denied = screen(p({ proposalId: "low", confidence: 0.1 }), ctx)
    expect(denied).toMatchObject({ ok: false, denial: { proposalId: "low", code: "LOW_CONFIDENCE" } })
  })
})
