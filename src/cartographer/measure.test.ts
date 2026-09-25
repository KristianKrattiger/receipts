import { describe, expect, it } from "vitest"
import type { SdkProposalClient } from "./anthropic.js"
import { MEASURE_SYSTEM, measureUserMessage, toMeasureVerifier } from "./measure.js"

const VERDICT = {
  claim_property: "p", claim_scope: "s", evidence_property: "q", evidence_scope: "t",
  same_property: true, comparable_scope: false,
}
const INPUT = { claim: "Acme guarantees 99.99% uptime.", evidence: "Acme was down for six hours.", relation: "contradicts" as const }

function sdk(reply: object) {
  const bodies: Record<string, unknown>[] = []
  const client: SdkProposalClient = {
    beta: { messages: { parse: async (body) => { bodies.push(body as never); return reply as never } } },
  }
  return { client, bodies }
}

describe("toMeasureVerifier", () => {
  it("sends the two quotes and the relation under the measure prompt, and returns the verdict", async () => {
    const { client, bodies } = sdk({ stop_reason: "end_turn", parsed_output: VERDICT })
    const out = await toMeasureVerifier(client, "claude-test").verify(INPUT)
    expect(out).toEqual(VERDICT)
    expect(bodies[0]).toMatchObject({
      model: "claude-test", max_tokens: 1024, system: MEASURE_SYSTEM,
      messages: [{ role: "user", content: measureUserMessage(INPUT) }],
    })
    expect(measureUserMessage(INPUT)).toContain('"Acme guarantees 99.99% uptime."')
    expect(measureUserMessage(INPUT)).toContain('"Acme was down for six hours."')
    expect(measureUserMessage(INPUT)).toContain("contradicts")
  })

  it("throws 'refused' on a refusal and 'schema' on an unusable verdict", async () => {
    await expect(toMeasureVerifier(sdk({ stop_reason: "refusal" }).client).verify(INPUT)).rejects.toThrow("refused")
    await expect(toMeasureVerifier(sdk({ stop_reason: "end_turn", parsed_output: { same_property: "yes" } }).client).verify(INPUT))
      .rejects.toThrow("schema")
  })

  it("keeps the prompt free of the labeled rows it will be measured on", () => {
    for (const word of ["Tesla", "Vercel", "Chime", "Claude", "robotaxi", "Redis", "FDIC"]) {
      expect(MEASURE_SYSTEM).not.toContain(word)
    }
  })
})
