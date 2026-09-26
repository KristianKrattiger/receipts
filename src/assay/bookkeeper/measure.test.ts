import { describe, expect, it } from "vitest"
import { admitContext, admitScreened, orderForAdmission, screen } from "./admit.js"
import { measureDetail, verifyMeasures, type MeasureInput, type MeasureVerdict, type MeasureVerifier } from "./measure.js"
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
    doc("vendor", "claimant", "Acme guarantees 99.99% uptime for every workspace on a paid plan."),
    doc("status", "independent", "Acme reported four separate uptime incidents in the last ninety days."),
  ],
  failures: [],
}
const TERMS = tokenize("acme uptime")
const IDF = buildIdf(CORPUS.docs)
const ctx = admitContext(CORPUS, TERMS, IDF, undefined, TEST_PROFILE.lexicon)

function p(over: Partial<RelationProposal> = {}): RelationProposal {
  return {
    proposalId: "p0", type: "contradicts", topic: "uptime", statement: "the statement",
    from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime" },
    to: { docId: "status", quote: "four separate uptime incidents" },
    rationale: "the rationale", confidence: 0.9, ...over,
  }
}
const screenAll = (ps: RelationProposal[]) => orderForAdmission(ps).map((x) => screen(x, ctx))

const SAME: MeasureVerdict = {
  claim_property: "uptime", claim_scope: "every paid workspace",
  evidence_property: "uptime incidents", evidence_scope: "the last ninety days",
  same_property: true, comparable_scope: true,
}
function fake(decide: (input: MeasureInput) => MeasureVerdict | Error): MeasureVerifier & { calls: MeasureInput[] } {
  const calls: MeasureInput[] = []
  return {
    calls,
    async verify(input) {
      calls.push(input)
      const v = decide(input)
      if (v instanceof Error) throw v
      return v
    },
  }
}

describe("verifyMeasures", () => {
  it("admits a relational proposal the verifier passes", async () => {
    const out = await verifyMeasures(screenAll([p()]), fake(() => SAME))
    expect(admitScreened(out, ctx).admitted).toHaveLength(1)
  })

  it("denies NOT_SAME_MEASURE when either answer is false, naming both properties", async () => {
    for (const verdict of [{ ...SAME, same_property: false }, { ...SAME, comparable_scope: false }]) {
      const out = await verifyMeasures(screenAll([p()]), fake(() => verdict))
      const r = admitScreened(out, ctx)
      expect(r.admitted).toHaveLength(0)
      expect(r.denied).toEqual([{ proposalId: "p0", code: "NOT_SAME_MEASURE", detail: measureDetail(verdict) }])
      expect(measureDetail(verdict)).toBe("uptime (every paid workspace) vs uptime incidents (the last ninety days)")
    }
  })

  it("denies RELATION_UNVERIFIED on a failed call and keeps going", async () => {
    const out = await verifyMeasures(
      screenAll([p(), p({ proposalId: "p1", type: "updates" })]),
      fake((input) => (input.relation === "contradicts" ? new Error("refused") : SAME)),
    )
    const r = admitScreened(out, ctx)
    expect(r.denied).toContainEqual({ proposalId: "p0", code: "RELATION_UNVERIFIED", detail: "refused" })
    expect(r.admitted.map((a) => a.proposal.proposalId)).toEqual(["p1"])
  })

  it("throws when every verifier call fails", async () => {
    await expect(verifyMeasures(screenAll([p()]), fake(() => new Error("schema"))))
      .rejects.toThrow("every relation check failed (1/1); first: schema")
  })

  it("never asks about unsupported proposals or already-denied ones", async () => {
    const v = fake(() => SAME)
    await verifyMeasures(screenAll([
      p({ proposalId: "u", type: "unsupported", to: null }),
      p({ proposalId: "low", confidence: 0.1 }),
    ]), v)
    expect(v.calls).toEqual([])
  })

  it("denies a relational proposal with no evidence side RELATION_UNVERIFIED, without asking", async () => {
    const v = fake(() => SAME)
    const out = await verifyMeasures(screenAll([p({ to: null }), p({ proposalId: "p1", type: "updates" })]), v)
    const r = admitScreened(out, ctx)
    expect(r.denied).toContainEqual({ proposalId: "p0", code: "RELATION_UNVERIFIED", detail: "no evidence side" })
    expect(r.admitted.map((a) => a.proposal.proposalId)).toEqual(["p1"])
    expect(v.calls).toHaveLength(1)
  })

  it("does not throw on a batch holding only relational proposals with no evidence side", async () => {
    const v = fake(() => new Error("never called"))
    const out = await verifyMeasures(screenAll([p({ to: null })]), v)
    expect(v.calls).toEqual([])
    expect(admitScreened(out, ctx).denied).toEqual([{ proposalId: "p0", code: "RELATION_UNVERIFIED", detail: "no evidence side" }])
  })

  it("sends the two quotes and the relation, nothing else", async () => {
    const v = fake(() => SAME)
    await verifyMeasures(screenAll([p()]), v)
    expect(v.calls).toEqual([{
      claim: "Acme guarantees 99.99% uptime",
      evidence: "four separate uptime incidents",
      relation: "contradicts",
    }])
  })

  it("a denied proposal does not block a later one with the same claim", async () => {
    const out = await verifyMeasures(
      screenAll([p(), p({ proposalId: "p1", to: { docId: "status", quote: "in the last ninety days" } })]),
      fake((input) => (input.evidence.includes("four") ? { ...SAME, same_property: false } : SAME)),
    )
    const r = admitScreened(out, ctx)
    expect(r.admitted.map((a) => a.proposal.proposalId)).toEqual(["p1"])
    expect(r.denied.map((d) => d.code)).toEqual(["NOT_SAME_MEASURE"])
  })
})
