import { describe, expect, it } from "vitest"
import { assay } from "./index.js"
import type { ProposalClient } from "./cartographer/propose.js"
import type { MeasureVerifier } from "./bookkeeper/measure.js"
import type { PinnedCorpus, PinnedDoc } from "./types.js"
import { TEST_PROFILE } from "./test-profile.js"

function doc(over: Partial<PinnedDoc>): PinnedDoc {
  return {
    docId: "d", url: "https://example.com", label: "L", role: "claimant", kind: "vendor_site",
    fetchedAt: "2026-09-09T00:00:00.000Z", title: "T", text: "",
    stability: "volatile", pin: { kind: "hash", sha256: "00" }, driftHash: "00", ...over,
  }
}
const corpus: PinnedCorpus = {
  subject: "Acme",
  docs: [
    doc({ docId: "a", role: "claimant", text: "Acme guarantees 99.99% uptime for every account." }),
    doc({ docId: "b", role: "independent", text: "Acme has run without incident for the past year." }),
  ],
  failures: [],
}
const client: ProposalClient = {
  // planPasses fans a relational pass over doc "b" plus a separate
  // "unsupported"-only pass over the whole corpus; only answer the former,
  // as a real model would given the unsupported pass's "propose ONLY
  // unsupported claims" instruction — otherwise the same corroborates
  // proposal comes back from both passes as two identical findings.
  propose: async ({ user }) => ({
    stopReason: "end_turn",
    proposals: user.includes("propose ONLY unsupported claims") ? [] : [{
      type: "corroborates", topic: "uptime", statement: "s",
      from: { docId: "a", quote: "Acme guarantees 99.99% uptime for every account." },
      to: { docId: "b", quote: "Acme has run without incident for the past year." },
      rationale: "r", confidence: 0.9,
    }] as never,
  }),
}
const verdict = (ok: boolean): MeasureVerifier => ({
  verify: async () => ({
    claim_property: "uptime", claim_scope: "every account", evidence_property: "incidents",
    evidence_scope: "one year", same_property: ok, comparable_scope: ok,
  }),
})

describe("assay with a relation verifier", () => {
  it("stamps audit.relationCheck and admits what the verifier passes", async () => {
    const r = await assay(corpus, { subject: "Acme" }, { client, profile: TEST_PROFILE, verifier: verdict(true) })
    expect(r.outcome).toBe("ledger")
    expect(r.audit.relationCheck).toBe(true)
    if (r.outcome === "ledger") expect(r.rows).toHaveLength(1)
  })

  it("denies NOT_SAME_MEASURE, which still counts as anchored evidence", async () => {
    const r = await assay(corpus, { subject: "Acme" }, { client, profile: TEST_PROFILE, verifier: verdict(false) })
    expect(r.outcome).toBe("refusal")
    if (r.outcome === "refusal") expect(r.reason).toBe("BELOW_THRESHOLD")
    expect(r.audit.denied.map((d) => d.code)).toEqual(["NOT_SAME_MEASURE"])
    expect(r.audit.relationCheck).toBe(true)
  })

  it("leaves relationCheck absent without a verifier", async () => {
    const r = await assay(corpus, { subject: "Acme" }, { client, profile: TEST_PROFILE })
    expect("relationCheck" in r.audit).toBe(false)
  })
})
