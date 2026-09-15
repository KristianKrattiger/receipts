import { describe, expect, it } from "vitest"
import { buildExcerpts, planPasses, proposeAcrossPasses, proposeRelations, type ProposalClient, type ProposeDoc } from "./propose.js"
import type { Chunk } from "../types.js"

const DOCS: ProposeDoc[] = [
  {
    docId: "vendor", label: "Acme site",
    role: "claimant",
    text: "Acme guarantees 99.99% uptime.",
  },
]

const CANDIDATES: Chunk[] = [
  { chunkId: "vendor:0", docId: "vendor", start: 0, end: 29, text: "Acme guarantees 99.99% uptime." },
]

function client(response: Record<string, unknown>): ProposalClient {
  const parsed = response["parsed_output"] as { proposals?: unknown[] } | null | undefined
  return {
    propose: async () => ({
      proposals: (parsed?.proposals ?? null) as never,
      stopReason: response["stop_reason"] as string | undefined,
      stopCategory: (response["stop_details"] as { category?: string } | undefined)?.category,
    }),
  }
}

/** Captures Assay's propose() input. */
function capturingClient(response: Record<string, unknown>) {
  const seen: { system: string; user: string }[] = []
  const parsed = response["parsed_output"] as { proposals?: unknown[] } | null | undefined
  const stub: ProposalClient = {
    propose: async (input) => {
      seen.push(input)
      return {
        proposals: (parsed?.proposals ?? []) as never,
        stopReason: response["stop_reason"] as string | undefined,
      }
    },
  }
  return { stub, seen }
}

describe("buildExcerpts", () => {
  it("tags each excerpt with its docId and role", () => {
    const out = buildExcerpts(DOCS, CANDIDATES)
    expect(out).toContain("docId: vendor")
    expect(out).toContain("role: claimant")
    expect(out).toContain("Acme guarantees 99.99% uptime.")
  })
})

describe("proposeRelations", () => {
  const parsed = {
    proposals: [{
      type: "unsupported", topic: "uptime", statement: "uptime guarantee",
      from: { docId: "vendor", quote: "Acme guarantees 99.99% uptime." },
      to: null, rationale: "no independent source", confidence: 0.8,
    }],
  }

  it("assigns a proposalId to each proposal", async () => {
    const out = await proposeRelations("acme", DOCS, CANDIDATES, {
      client: client({ stop_reason: "end_turn", parsed_output: parsed }),
      system: "Sys.",
    })
    expect(out).toHaveLength(1)
    expect(out[0]!.proposalId).toBe("p0")
    expect(out[0]!.type).toBe("unsupported")
  })

  it("sends the caller's system prompt and the subject in the user message", async () => {
    const { stub, seen } = capturingClient({ stop_reason: "end_turn", parsed_output: parsed })
    await proposeRelations("acme", DOCS, CANDIDATES, { client: stub, system: "Sys." })
    const body = seen[0]!
    expect(body.system).toBe("Sys.")
    expect(body.user).toContain("Subject: acme")
  })

  it("throws when the caller omitted a client", async () => {
    await expect(proposeRelations("acme", DOCS, CANDIDATES, { system: "Sys." })).rejects.toThrow(/ProposalClient is required/)
  })

  it("throws when the model declines", async () => {
    await expect(
      proposeRelations("acme", DOCS, CANDIDATES, {
        client: client({ stop_reason: "refusal", stop_details: { category: "cyber" }, parsed_output: null }),
        system: "Sys.",
      }),
    ).rejects.toThrow(/declined/)
  })

  it("throws when structured output fails to parse", async () => {
    await expect(
      proposeRelations("acme", DOCS, CANDIDATES, {
        client: client({ stop_reason: "end_turn", parsed_output: null }),
        system: "Sys.",
      }),
    ).rejects.toThrow(/parse/)
  })
})

const FANNED_DOCS: ProposeDoc[] = [
  { docId: "v1", label: "site", role: "claimant", text: "a" },
  { docId: "v2", label: "docs", role: "claimant", text: "a" },
  { docId: "i1", label: "status", role: "independent", text: "a" },
  { docId: "i2", label: "hn", role: "independent", text: "a" },
]

const chunk = (docId: string, i: number): Chunk =>
  ({ chunkId: `${docId}:${i}`, docId, start: 0, end: 1, text: `${docId} text` })

const FANNED_CANDIDATES: Chunk[] = [
  chunk("v1", 0), chunk("v2", 0), chunk("i1", 0), chunk("i2", 0),
]

describe("planPasses", () => {
  it("makes one pass per independent document", () => {
    const passes = planPasses(FANNED_DOCS, FANNED_CANDIDATES)
    expect(passes.map((p) => p.passId)).toEqual(["i1", "i2", "self", "unsupported"])
  })

  it("gives every pass the whole claimant side and exactly one independent source", () => {
    const [first] = planPasses(FANNED_DOCS, FANNED_CANDIDATES)
    expect(first!.candidates.map((c) => c.docId)).toEqual(["v1", "v2", "i1"])
  })

  // admit has always allowed both sides to share a role, but nothing ever asked
  // the model for a vendor contradicting its own docs, because the independent
  // sources were in the same prompt and always more obviously interesting.
  it("adds a claimant-only pass so self-contradiction can be proposed", () => {
    const self = planPasses(FANNED_DOCS, FANNED_CANDIDATES).find((p) => p.passId === "self")
    expect(self!.candidates.map((c) => c.docId)).toEqual(["v1", "v2"])
  })

  it("omits the self pass when only one claimant document was read", () => {
    const docs = FANNED_DOCS.filter((d) => d.docId !== "v2")
    const cands = FANNED_CANDIDATES.filter((c) => c.docId !== "v2")
    expect(planPasses(docs, cands).map((p) => p.passId)).toEqual(["i1", "i2", "unsupported"])
  })

  // A corpus with nothing to compare against still yields unsupported-claim
  // rows, so it must not plan zero passes and return an empty ledger.
  it("falls back to a single pass when no independent source was read", () => {
    const docs = FANNED_DOCS.filter((d) => d.role === "claimant")
    const cands = FANNED_CANDIDATES.filter((c) => c.docId.startsWith("v"))
    expect(planPasses(docs, cands).map((p) => p.passId)).toEqual(["all"])
  })
})

describe("proposeAcrossPasses", () => {
  const one = {
    parsed_output: {
      proposals: [{
        type: "contradicts", topic: "uptime", statement: "uptime",
        from: { docId: "v1", quote: "a" }, to: { docId: "i1", quote: "b" },
        rationale: "r", confidence: 0.9,
      }],
    },
  }

  it("calls the model once per planned pass", async () => {
    const { stub, seen } = capturingClient(one)
    const out = await proposeAcrossPasses("acme", FANNED_DOCS, FANNED_CANDIDATES, { client: stub, system: "Sys." })
    expect(seen).toHaveLength(4)
    expect(out.passes).toBe(4)
    expect(out.proposals).toHaveLength(4)
  })

  // proposeRelations numbers from p0 on every call. Merging without a namespace
  // silently collides ids, and the audit trail is the thing that makes the
  // engine's guarantee checkable.
  it("namespaces proposal ids so merged passes cannot collide", async () => {
    const out = await proposeAcrossPasses("acme", FANNED_DOCS, FANNED_CANDIDATES, { client: client(one), system: "Sys." })
    const ids = out.proposals.map((p) => p.proposalId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(["i1:p0", "i2:p0", "self:p0", "unsupported:p0"])
  })

  // One refused or malformed response out of six is a partial ledger. Losing
  // the other five to it would be the worse outcome.
  it("reports a failed pass and keeps the rest", async () => {
    let call = 0
    const flaky: ProposalClient = {
      propose: async () => {
        call += 1
        if (call === 2) throw new Error("model declined")
        return {
          proposals: one.parsed_output.proposals as never,
          stopReason: "end_turn",
        }
      },
    }
    const out = await proposeAcrossPasses("acme", FANNED_DOCS, FANNED_CANDIDATES, { client: flaky, system: "Sys." })
    expect(out.proposals).toHaveLength(3)
    expect(out.failures).toEqual([{ passId: expect.any(String), message: "model declined" }])
  })

  it("keeps working when concurrency exceeds the number of passes", async () => {
    const out = await proposeAcrossPasses("acme", FANNED_DOCS, FANNED_CANDIDATES, {
      client: client(one), concurrency: 99, system: "Sys.",
    })
    expect(out.proposals).toHaveLength(4)
  })
})

describe("planPasses — only the whole corpus can call a claim unsupported", () => {
  it("adds one unsupported pass that sees every excerpt", () => {
    const pass = planPasses(FANNED_DOCS, FANNED_CANDIDATES).find((p) => p.passId === "unsupported")
    expect(pass!.mode).toBe("unsupported")
    expect(pass!.candidates).toEqual(FANNED_CANDIDATES)
  })

  it("marks every per-source pass relational", () => {
    const passes = planPasses(FANNED_DOCS, FANNED_CANDIDATES)
    expect(passes.filter((p) => p.mode === "relational").map((p) => p.passId))
      .toEqual(["i1", "i2", "self"])
  })

  it("tells a relational pass not to judge what it cannot see", async () => {
    const { stub, seen } = capturingClient({ parsed_output: { proposals: [] } })
    await proposeRelations("acme", FANNED_DOCS, FANNED_CANDIDATES, { client: stub, mode: "relational", system: "Sys." })
    const body = seen[0]!
    expect(body.user).toContain("Do NOT propose unsupported in this pass")
  })

  it("tells the unsupported pass it is holding the whole corpus", async () => {
    const { stub, seen } = capturingClient({ parsed_output: { proposals: [] } })
    await proposeRelations("acme", FANNED_DOCS, FANNED_CANDIDATES, { client: stub, mode: "unsupported", system: "Sys." })
    const body = seen[0]!
    expect(body.user).toContain("propose ONLY unsupported")
  })
})

// The confidence-scale wording (what the number measures, that it is not
// truth, that the gate is unmentioned) lived in the engine's own SYSTEM
// constant and was asserted on here. That string is now Receipts' prompt,
// not the engine's — it moved verbatim to `RECEIPTS.system` in
// src/instance/profile.ts, which isolation forbids this file from importing.
// Its content is no longer this engine's to assert on: `system` here is
// caller-supplied and merely echoed verbatim (see "sends the caller's system
// prompt..." above). The byte-identical move is instead checked by
// `npm run replay` still replaying the committed Tesla ledger.
