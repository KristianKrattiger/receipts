import { parseExcerpts } from "../assay/cartographer/propose.js"
import { ProposalBatchSchema } from "../assay/cartographer/schema.js"
import type { SdkProposalClient } from "./anthropic.js"

/**
 * A parse-shaped client backed by GIN's SEAR proposer sidecar
 * (scripts/assay_proposer_serve.py in the GIN repo), so the proposal cache,
 * the replay manifest, and `toAssayClient` see the same body they see from
 * the Anthropic SDK -- the model id in that body is what keys the cache.
 *
 * Where Ollama constrains the output's *shape*, SEAR constrains its *quotes*:
 * each from/to quote is decoded as a copy of one sentence of one excerpt line
 * of the right role, so it cannot be paraphrased or misattributed. That needs
 * the excerpts as data, which is why they ride along beside the messages.
 */
export function searClient(opts: { host?: string; fetch?: typeof globalThis.fetch } = {}): SdkProposalClient {
  const host = (opts.host ?? process.env["SEAR_HOST"] ?? "http://127.0.0.1:8766").replace(/\/$/, "")
  const doFetch = opts.fetch ?? globalThis.fetch
  return {
    beta: {
      messages: {
        parse: async (body) => {
          const user = body.messages.at(-1)?.content ?? ""
          const excerpts = parseExcerpts(user)
          if (excerpts.length === 0) throw new Error("sear: the user message carries no excerpts")
          const response = await doFetch(`${host}/v1/propose`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: body.model,
              system: body.system,
              messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
              excerpts,
            }),
          })
          if (!response.ok) throw new Error(`sear: ${response.status} ${await response.text()}`)
          const reply = await response.json() as { proposals?: unknown; stop_reason?: string }
          const batch = ProposalBatchSchema.safeParse({ proposals: reply.proposals })
          if (!batch.success) {
            throw new Error(`sear: response did not match the proposal schema: ${batch.error.issues[0]?.message ?? "unknown"}`)
          }
          return { stop_reason: reply.stop_reason ?? "end_turn", parsed_output: batch.data }
        },
      },
    },
  }
}
