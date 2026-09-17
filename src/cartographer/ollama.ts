import { z } from "zod"
import { ProposalBatchSchema } from "../assay/cartographer/schema.js"
import type { SdkProposalClient } from "./anthropic.js"

/**
 * A parse-shaped client backed by a local Ollama server, so the proposal
 * cache, the replay manifest, and `toAssayClient` see the same body they see
 * from the Anthropic SDK -- the model id in that body is what keys the cache.
 *
 * Ollama's `format: "json"` only constrains output to be valid JSON, not any
 * particular shape. Passing the real JSON Schema switches it to
 * grammar-constrained decoding against these exact fields, the guarantee
 * `betaZodOutputFormat` gives the Anthropic client.
 */
const RESPONSE_FORMAT = z.toJSONSchema(ProposalBatchSchema)

export function ollamaClient(opts: { host?: string; fetch?: typeof globalThis.fetch } = {}): SdkProposalClient {
  const host = (opts.host ?? process.env["OLLAMA_HOST"] ?? "http://127.0.0.1:11434").replace(/\/$/, "")
  const doFetch = opts.fetch ?? globalThis.fetch
  return {
    beta: {
      messages: {
        parse: async (body) => {
          const response = await doFetch(`${host}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: body.model,
              stream: false,
              format: RESPONSE_FORMAT,
              messages: [
                { role: "system", content: body.system },
                ...body.messages.map((m) => ({ role: m.role, content: m.content })),
              ],
            }),
          })
          if (!response.ok) throw new Error(`ollama: ${response.status} ${await response.text()}`)
          const reply = await response.json() as { message?: { content?: string } }
          const raw = reply.message?.content
          if (!raw) throw new Error("ollama: empty message")
          let parsed: unknown
          try {
            parsed = JSON.parse(raw)
          } catch {
            throw new Error("ollama: message was not JSON")
          }
          const batch = ProposalBatchSchema.safeParse(parsed)
          if (!batch.success) {
            throw new Error(`ollama: response did not match the proposal schema: ${batch.error.issues[0]?.message ?? "unknown"}`)
          }
          return { stop_reason: "end_turn", parsed_output: batch.data }
        },
      },
    },
  }
}
