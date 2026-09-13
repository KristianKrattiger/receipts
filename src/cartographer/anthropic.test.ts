import { describe, expect, it } from "vitest"
import { MODEL, toAssayClient, type SdkProposalClient } from "./anthropic.js"

function capturingSdk(response: Record<string, unknown>) {
  const seen: unknown[] = []
  const stub: SdkProposalClient = {
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

describe("toAssayClient", () => {
  // No API key is available, so the request shape cannot be verified against
  // the live API. Pinning it here is the next best guard: a silent change to
  // the model id or a reintroduced thinking parameter fails the build, and
  // Tesla's cache keys are this body.
  it("sends the model id and beta output_format, and no thinking parameter", async () => {
    const { stub, seen } = capturingSdk({ stop_reason: "end_turn", parsed_output: { proposals: [] } })
    await toAssayClient(stub).propose({ system: "character-for-character quotes", user: "Subject: acme" })
    const body = seen[0] as Record<string, unknown>
    expect(body.model).toBe(MODEL)
    expect(body.model).toBe("claude-opus-5")
    expect(body.max_tokens).toBe(16000)
    expect(body.output_format).toMatchObject({ type: "json_schema" })
    expect(String(body.system)).toContain("character-for-character")
    expect(JSON.stringify(body.messages)).toContain("acme")
    expect(body).not.toHaveProperty("thinking")
  })

  it("throws when the model declines", async () => {
    const { stub } = capturingSdk({
      stop_reason: "refusal",
      stop_details: { category: "cyber" },
      parsed_output: null,
    })
    await expect(toAssayClient(stub).propose({ system: "s", user: "u" })).rejects.toThrow(/declined/)
  })

  it("throws when structured output fails to parse", async () => {
    const { stub } = capturingSdk({ stop_reason: "end_turn", parsed_output: null })
    await expect(toAssayClient(stub).propose({ system: "s", user: "u" })).rejects.toThrow(/parse/)
  })
})
