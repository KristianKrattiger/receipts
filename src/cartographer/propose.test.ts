import { describe, expect, it } from "vitest"
import { buildExcerpts, proposeRelations, type ProposalClient } from "./propose.js"
import type { Chunk, FetchedDoc } from "../types.js"

const DOCS: FetchedDoc[] = [
  {
    docId: "vendor", url: "https://acme.com", label: "Acme site",
    role: "claimant", kind: "vendor_site",
    fetchedAt: "2026-08-31T00:00:00.000Z", title: "Acme",
    text: "Acme guarantees 99.99% uptime.", sessionId: "s1",
  },
]

const CANDIDATES: Chunk[] = [
  { chunkId: "vendor:0", docId: "vendor", start: 0, end: 29, text: "Acme guarantees 99.99% uptime." },
]

function client(response: Record<string, unknown>): ProposalClient {
  return { beta: { messages: { parse: async () => response as never } } }
}

/** Captures the request body so the shape sent to the API is assertable. */
function capturingClient(response: Record<string, unknown>) {
  const seen: unknown[] = []
  const stub: ProposalClient = {
    beta: {
      messages: {
        parse: async (body) => {
          seen.push(body)
          return response as never
        },
      },
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
    })
    expect(out).toHaveLength(1)
    expect(out[0]!.proposalId).toBe("p0")
    expect(out[0]!.type).toBe("unsupported")
  })

  // No API key is available, so the request shape cannot be verified against
  // the live API. Pinning it here is the next best guard: a silent change to
  // the model id or a reintroduced thinking parameter fails the build.
  it("sends the model id and beta output_format, and no thinking parameter", async () => {
    const { stub, seen } = capturingClient({ stop_reason: "end_turn", parsed_output: parsed })
    await proposeRelations("acme", DOCS, CANDIDATES, { client: stub })
    const body = seen[0] as Record<string, unknown>
    expect(body.model).toBe("claude-opus-5")
    expect(body.max_tokens).toBe(16000)
    // A bare toHaveProperty would pass for any truthy value, including a
    // helper that silently stopped producing a schema.
    expect(body.output_format).toMatchObject({ type: "json_schema" })
    expect(String(body.system)).toContain("character-for-character")
    expect(JSON.stringify(body.messages)).toContain("acme")
    // Adaptive thinking is the default on claude-opus-5 and this SDK version
    // has no type for it; budget_tokens would be rejected outright.
    expect(body).not.toHaveProperty("thinking")
  })

  it("throws when the model declines", async () => {
    await expect(
      proposeRelations("acme", DOCS, CANDIDATES, {
        client: client({ stop_reason: "refusal", stop_details: { category: "cyber" }, parsed_output: null }),
      }),
    ).rejects.toThrow(/declined/)
  })

  it("throws when structured output fails to parse", async () => {
    await expect(
      proposeRelations("acme", DOCS, CANDIDATES, {
        client: client({ stop_reason: "end_turn", parsed_output: null }),
      }),
    ).rejects.toThrow(/parse/)
  })
})
