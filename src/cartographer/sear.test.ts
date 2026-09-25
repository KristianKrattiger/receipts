import { describe, expect, it } from "vitest"
import { buildExcerpts, proposeRelations } from "../assay/cartographer/propose.js"
import { toAssayClient } from "./anthropic.js"
import { searClient } from "./sear.js"

const PROPOSAL = {
  type: "contradicts", topic: "uptime", statement: "Acme's uptime guarantee is contradicted",
  from: { docId: "a", quote: "Acme guarantees 99.99% uptime." },
  to: { docId: "hn", quote: "Acme was down for six hours." }, rationale: "an outage", confidence: 0.6,
}

const USER = "Subject: acme\nTask: compare\n\nExcerpts:\n\n" + buildExcerpts(
  [
    { docId: "a", role: "claimant", label: "Acme site", text: "" },
    { docId: "hn", role: "independent", label: "Hacker News", text: "" },
  ],
  [
    { chunkId: "a:0", docId: "a", start: 0, end: 30, text: "Acme guarantees 99.99% uptime." },
    { chunkId: "hn:0", docId: "hn", start: 0, end: 28, text: "Acme was down for six hours." },
  ],
)

function fakeFetch(reply: { status?: number; body?: unknown; text?: string }) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetch = (async (url: string | URL, init?: { body?: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") as Record<string, unknown> })
    const status = reply.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.body,
      text: async () => reply.text ?? "",
    }
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

describe("searClient", () => {
  it("posts model, system, messages and the excerpts the user message carries", async () => {
    const { fetch, calls } = fakeFetch({ body: { model: "sear/q", proposals: [PROPOSAL], stop_reason: "end_turn" } })
    const client = toAssayClient(searClient({ host: "http://sear.test:8766/", fetch }), "sear/q")
    const out = await client.propose({ system: "Sys.", user: USER })
    expect(out.proposals).toEqual([PROPOSAL])
    expect(out.stopReason).toBe("end_turn")
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("http://sear.test:8766/v1/propose")
    expect(calls[0]!.body).toEqual({
      model: "sear/q",
      system: "Sys.",
      messages: [{ role: "user", content: USER }],
      excerpts: [
        { docId: "a", role: "claimant", label: "Acme site", text: "Acme guarantees 99.99% uptime." },
        { docId: "hn", role: "independent", label: "Hacker News", text: "Acme was down for six hours." },
      ],
    })
  })

  it("sends the pass mode its task line names, so the sidecar can decode a relational pass evidence-first", async () => {
    for (const mode of ["relational", "unsupported"] as const) {
      const { fetch, calls } = fakeFetch({ body: { model: "m", proposals: [], stop_reason: "end_turn" } })
      await proposeRelations(
        "acme",
        [{ docId: "a", role: "claimant", label: "Acme site", text: "" }],
        [{ chunkId: "a:0", docId: "a", start: 0, end: 30, text: "Acme guarantees 99.99% uptime." }],
        { client: toAssayClient(searClient({ fetch }), "m"), mode, system: "s" },
      )
      expect(calls[0]!.body.mode).toBe(mode)
    }
  })

  it("reads the host from SEAR_HOST, defaulting to the sidecar's port", async () => {
    const reply = { body: { model: "m", proposals: [], stop_reason: "end_turn" } }
    const prev = process.env["SEAR_HOST"]
    try {
      delete process.env["SEAR_HOST"]
      const dflt = fakeFetch(reply)
      await toAssayClient(searClient({ fetch: dflt.fetch }), "m").propose({ system: "s", user: USER })
      expect(dflt.calls[0]!.url).toBe("http://127.0.0.1:8766/v1/propose")
      process.env["SEAR_HOST"] = "http://env.test:1"
      const env = fakeFetch(reply)
      await toAssayClient(searClient({ fetch: env.fetch }), "m").propose({ system: "s", user: USER })
      expect(env.calls[0]!.url).toBe("http://env.test:1/v1/propose")
    } finally {
      if (prev === undefined) delete process.env["SEAR_HOST"]
      else process.env["SEAR_HOST"] = prev
    }
  })

  it("refuses to call the sidecar with no excerpts to ground quotes in", async () => {
    const { fetch, calls } = fakeFetch({ body: { model: "m", proposals: [], stop_reason: "end_turn" } })
    await expect(toAssayClient(searClient({ fetch }), "m").propose({ system: "s", user: "Subject: acme" }))
      .rejects.toThrow("sear: the user message carries no excerpts")
    expect(calls).toHaveLength(0)
  })

  it("throws naming the status and the sidecar's reason when it refuses", async () => {
    const { fetch } = fakeFetch({ status: 409, text: '{"detail":"this proposer serves sear/q, not m"}' })
    await expect(toAssayClient(searClient({ fetch }), "m").propose({ system: "s", user: USER }))
      .rejects.toThrow('sear: 409 {"detail":"this proposer serves sear/q, not m"}')
  })

  it("throws when the reply does not match the proposal schema", async () => {
    const { fetch } = fakeFetch({ body: { model: "m", proposals: [{ type: "maybe" }], stop_reason: "end_turn" } })
    await expect(toAssayClient(searClient({ fetch }), "m").propose({ system: "s", user: USER }))
      .rejects.toThrow(/sear: response did not match the proposal schema/)
  })
})
