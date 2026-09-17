import { describe, expect, it } from "vitest"
import { toAssayClient } from "./anthropic.js"
import { ollamaClient } from "./ollama.js"

const PROPOSAL = {
  type: "unsupported", topic: "uptime", statement: "Acme's uptime guarantee",
  from: { docId: "a", quote: "Acme guarantees 99.99% uptime." },
  to: null, rationale: "nothing confirms it", confidence: 0.6,
}

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

describe("ollamaClient", () => {
  it("posts the parse body's model, system, and user message with the proposal schema as the format", async () => {
    const { fetch, calls } = fakeFetch({ body: { message: { content: JSON.stringify({ proposals: [PROPOSAL] }) } } })
    const client = toAssayClient(ollamaClient({ host: "http://ollama.test:11434/", fetch }), "qwen2.5:7b")
    const out = await client.propose({ system: "Sys.", user: "Subject: acme" })
    expect(out.proposals).toEqual([PROPOSAL])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("http://ollama.test:11434/api/chat")
    const body = calls[0]!.body
    expect(body.model).toBe("qwen2.5:7b")
    expect(body.stream).toBe(false)
    expect(body.messages).toEqual([{ role: "system", content: "Sys." }, { role: "user", content: "Subject: acme" }])
    expect(body.format).toMatchObject({ type: "object", properties: { proposals: expect.anything() } })
  })

  it("reads the host from OLLAMA_HOST when none is given", async () => {
    const { fetch, calls } = fakeFetch({ body: { message: { content: JSON.stringify({ proposals: [] }) } } })
    const prev = process.env["OLLAMA_HOST"]
    process.env["OLLAMA_HOST"] = "http://env.test:1"
    try {
      await toAssayClient(ollamaClient({ fetch }), "m").propose({ system: "s", user: "u" })
    } finally {
      if (prev === undefined) delete process.env["OLLAMA_HOST"]
      else process.env["OLLAMA_HOST"] = prev
    }
    expect(calls[0]!.url).toBe("http://env.test:1/api/chat")
  })

  it("throws naming the status when Ollama refuses the request", async () => {
    const { fetch } = fakeFetch({ status: 404, text: "model not found" })
    await expect(toAssayClient(ollamaClient({ fetch }), "m").propose({ system: "s", user: "u" }))
      .rejects.toThrow("ollama: 404 model not found")
  })

  it("throws when the message is empty or not JSON", async () => {
    const empty = fakeFetch({ body: { message: { content: "" } } })
    await expect(toAssayClient(ollamaClient({ fetch: empty.fetch }), "m").propose({ system: "s", user: "u" }))
      .rejects.toThrow("ollama: empty message")
    const prose = fakeFetch({ body: { message: { content: "Sure! Here are the relations:" } } })
    await expect(toAssayClient(ollamaClient({ fetch: prose.fetch }), "m").propose({ system: "s", user: "u" }))
      .rejects.toThrow("ollama: message was not JSON")
  })

  it("throws when the JSON does not match the proposal schema", async () => {
    const { fetch } = fakeFetch({ body: { message: { content: JSON.stringify({ proposals: [{ type: "maybe" }] }) } } })
    await expect(toAssayClient(ollamaClient({ fetch }), "m").propose({ system: "s", user: "u" }))
      .rejects.toThrow(/ollama: response did not match the proposal schema/)
  })
})
