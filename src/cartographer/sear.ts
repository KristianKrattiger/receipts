import { request as httpRequest } from "node:http"
import { ProposalBatchSchema } from "../assay/cartographer/schema.js"
import type { SdkProposalClient } from "./anthropic.js"

/** Every SEAR proposer's model id starts with this; `toAssayClient` keys the excerpts on it. */
export const SEAR_MODEL_PREFIX = "sear/"

export type Post = (url: string, body: unknown) => Promise<{ status: number; text: string }>

/**
 * POST JSON with no timeout. The sidecar decodes one request at a time and
 * the engine sends passes three at a time, so a queued request can wait
 * longer than fetch's default 300-second headers timeout on a CPU rig.
 * http:// only -- the sidecar binds localhost.
 */
export const postJson: Post = (url, body) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = httpRequest(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }))
        res.on("error", reject)
      },
    )
    req.on("error", reject)
    req.end(payload)
  })

/**
 * A parse-shaped client backed by gin's SEAR proposer sidecar
 * (gin/scripts/assay_proposer_serve.py). The sidecar copies every quote out
 * of the excerpts at decode time, so a quote that is not a sentence of the
 * right document is unreachable; admit() still checks every quote
 * afterwards, as it does for every proposer.
 */
export function searClient(opts: { host?: string; post?: Post } = {}): SdkProposalClient {
  const host = (opts.host ?? process.env["SEAR_HOST"] ?? "http://127.0.0.1:8766").replace(/\/$/, "")
  const post = opts.post ?? postJson
  return {
    beta: {
      messages: {
        parse: async (body) => {
          if (!body.model.startsWith(SEAR_MODEL_PREFIX)) {
            throw new Error(`sear: model id must start with ${SEAR_MODEL_PREFIX}, got ${body.model}`)
          }
          if (!body.excerpts) {
            throw new Error("sear: request carries no excerpts; the proposer copies its quotes out of them")
          }
          const response = await post(`${host}/v1/propose`, {
            model: body.model,
            system: body.system,
            messages: body.messages,
            excerpts: body.excerpts,
          })
          if (response.status < 200 || response.status >= 300) {
            throw new Error(`sear: ${response.status} ${response.text}`)
          }
          let reply: { model?: unknown; proposals?: unknown }
          try {
            reply = JSON.parse(response.text) as { model?: unknown; proposals?: unknown }
          } catch {
            throw new Error("sear: response was not JSON")
          }
          if (reply.model !== body.model) {
            throw new Error(`sear: asked for ${body.model}, the proposer answered as ${String(reply.model)}`)
          }
          const batch = ProposalBatchSchema.safeParse({ proposals: reply.proposals })
          if (!batch.success) {
            throw new Error(`sear: response did not match the proposal schema: ${batch.error.issues[0]?.message ?? "unknown"}`)
          }
          return { stop_reason: "end_turn", parsed_output: batch.data }
        },
      },
    },
  }
}
