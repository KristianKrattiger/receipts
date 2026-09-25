import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"
import { toAssayClient } from "./anthropic.js"
import { postJson, searClient } from "./sear.js"

const PROPOSAL = {
  type: "unsupported", topic: "uptime", statement: "Acme's uptime guarantee",
  from: { docId: "a", quote: "Acme guarantees 99.99% uptime." },
  to: null, rationale: "nothing confirms it", confidence: 0.6,
}
const EXCERPTS = [{ docId: "a", role: "claimant" as const, label: "Acme", text: "Acme guarantees 99.99% uptime." }]
const MODEL_ID = "sear/Qwen2.5-7B-Instruct-Q6_K"

function fakePost(reply: { status?: number; body?: unknown; text?: string }) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const post = async (url: string, body: unknown) => {
    calls.push({ url, body: body as Record<string, unknown> })
    return { status: reply.status ?? 200, text: reply.text ?? JSON.stringify(reply.body) }
  }
  return { post, calls }
}

describe("searClient", () => {
  it("posts model, system, messages and the structured excerpts, and returns the validated batch", async () => {
    const { post, calls } = fakePost({ body: { model: MODEL_ID, proposals: [PROPOSAL], stop_reason: "end_turn" } })
    const client = toAssayClient(searClient({ host: "http://sear.test:8766/", post }), MODEL_ID)
    const out = await client.propose({ system: "Sys.", user: "Subject: acme", excerpts: EXCERPTS })
    expect(out.proposals).toEqual([PROPOSAL])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("http://sear.test:8766/v1/propose")
    expect(calls[0]!.body).toEqual({
      model: MODEL_ID,
      system: "Sys.",
      messages: [{ role: "user", content: "Subject: acme" }],
      excerpts: EXCERPTS,
    })
  })

  it("reads the host from SEAR_HOST when none is given", async () => {
    const { post, calls } = fakePost({ body: { model: MODEL_ID, proposals: [] } })
    const prev = process.env["SEAR_HOST"]
    process.env["SEAR_HOST"] = "http://env.test:1"
    try {
      await toAssayClient(searClient({ post }), MODEL_ID).propose({ system: "s", user: "u", excerpts: EXCERPTS })
    } finally {
      if (prev === undefined) delete process.env["SEAR_HOST"]
      else process.env["SEAR_HOST"] = prev
    }
    expect(calls[0]!.url).toBe("http://env.test:1/v1/propose")
  })

  it("refuses a reply from a different model", async () => {
    const { post } = fakePost({ body: { model: "sear/other", proposals: [] } })
    await expect(toAssayClient(searClient({ post }), MODEL_ID).propose({ system: "s", user: "u", excerpts: EXCERPTS }))
      .rejects.toThrow(`sear: asked for ${MODEL_ID}, the proposer answered as sear/other`)
  })

  it("refuses a request without excerpts, before posting", async () => {
    const { post, calls } = fakePost({ body: { model: MODEL_ID, proposals: [] } })
    await expect(toAssayClient(searClient({ post }), MODEL_ID).propose({ system: "s", user: "u" }))
      .rejects.toThrow("sear: request carries no excerpts")
    expect(calls).toHaveLength(0)
  })

  it("refuses a model id without the sear/ prefix, before posting", async () => {
    const { post, calls } = fakePost({ body: { model: "qwen2.5:7b", proposals: [] } })
    await expect(toAssayClient(searClient({ post }), "qwen2.5:7b").propose({ system: "s", user: "u", excerpts: EXCERPTS }))
      .rejects.toThrow("sear: model id must start with sear/")
    expect(calls).toHaveLength(0)
  })

  it("throws naming the status when the proposer refuses the request", async () => {
    const { post } = fakePost({ status: 409, text: JSON.stringify({ detail: "this proposer serves sear/x" }) })
    await expect(toAssayClient(searClient({ post }), MODEL_ID).propose({ system: "s", user: "u", excerpts: EXCERPTS }))
      .rejects.toThrow("sear: 409 this proposer serves sear/x")
  })

  it("throws with plain text error when the proposer response is not JSON", async () => {
    const { post } = fakePost({ status: 500, text: "upstream exploded" })
    await expect(toAssayClient(searClient({ post }), MODEL_ID).propose({ system: "s", user: "u", excerpts: EXCERPTS }))
      .rejects.toThrow("sear: 500 upstream exploded")
  })

  it("throws when the proposer is not reachable", async () => {
    const post = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:8766")
    }
    await expect(toAssayClient(searClient({ host: "http://127.0.0.1:8766", post }), MODEL_ID).propose({ system: "s", user: "u", excerpts: EXCERPTS }))
      .rejects.toThrow(/sear: could not reach the proposer at.*ECONNREFUSED/)
  })

  it("throws when the reply does not match the proposal schema", async () => {
    const { post } = fakePost({ body: { model: MODEL_ID, proposals: [{ type: "bogus" }] } })
    await expect(toAssayClient(searClient({ post }), MODEL_ID).propose({ system: "s", user: "u", excerpts: EXCERPTS }))
      .rejects.toThrow(/sear: response did not match the proposal schema/)
  })
})

describe("postJson", () => {
  it("round-trips JSON through a real local HTTP server", async () => {
    const server = createServer((req, res) => {
      let data = ""
      req.on("data", (c) => (data += c))
      req.on("end", () => {
        res.writeHead(201, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ got: JSON.parse(data) }))
      })
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    const { port } = server.address() as AddressInfo
    try {
      const out = await postJson(`http://127.0.0.1:${port}/x`, { a: 1 })
      expect(out.status).toBe(201)
      expect(JSON.parse(out.text)).toEqual({ got: { a: 1 } })
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })
})
