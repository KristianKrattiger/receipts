import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import type { ParsedBetaMessage } from "@anthropic-ai/sdk/lib/beta-parser"
import type { ProposalClient } from "../assay/cartographer/propose.js"
import { ProposalBatchSchema } from "../assay/cartographer/schema.js"
import type { RelationProposal } from "../assay/types.js"

export const MODEL = "claude-opus-5"

/**
 * Structured outputs live on the beta namespace in @anthropic-ai/sdk 0.70.x.
 * This is the parse-shaped client the proposal cache wraps. Assay never sees it.
 */
interface ParseRequest {
  model: string
  max_tokens: number
  system: string
  messages: { role: "user"; content: string }[]
  output_format: ReturnType<typeof betaZodOutputFormat>
}

type ProposalBatch = { proposals: Omit<RelationProposal, "proposalId">[] }
type SdkParsed = Pick<Partial<ParsedBetaMessage<ProposalBatch>>, "parsed_output">

interface ParseResponse extends SdkParsed {
  stop_reason?: string | null
  stop_details?: { category?: string | null } | null
}

export interface SdkProposalClient {
  beta: { messages: { parse(body: ParseRequest): Promise<ParseResponse> } }
}

export function defaultClient(): SdkProposalClient {
  const workspaceId = process.env["ANTHROPIC_WORKSPACE_ID"]
  return new Anthropic(
    workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {},
  ) as unknown as SdkProposalClient
}

/**
 * Translate the SDK parse client into Assay's `propose({ system, user })`.
 *
 * The parse body must stay byte-stable with what Tesla's cache was keyed on:
 * model, max_tokens 16000, system, messages, output_format. `model` is part
 * of that key, so a ledger stamped by another proposer names it in its
 * manifest and replay asks for the same one.
 */
export function toAssayClient(sdk: SdkProposalClient, model: string = MODEL): ProposalClient {
  return {
    async propose({ system, user }) {
      const request: ParseRequest = {
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: user }],
        output_format: betaZodOutputFormat(ProposalBatchSchema),
      }
      const response = await sdk.beta.messages.parse(request)
      if (response.stop_reason === "refusal") {
        throw new Error(`cartographer: model declined (${response.stop_details?.category ?? "unknown"})`)
      }
      const parsed = response.parsed_output
      if (!parsed) throw new Error("cartographer: structured output failed to parse")
      return {
        proposals: parsed.proposals,
        stopReason: response.stop_reason,
        stopCategory: response.stop_details?.category,
      }
    },
  }
}
