import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import type { ParsedBetaMessage } from "@anthropic-ai/sdk/lib/beta-parser"
import { ProposalBatchSchema } from "./schema.js"
import type { Chunk, FetchedDoc, RelationProposal } from "../types.js"

export const MODEL = "claude-opus-5"

/**
 * Structured outputs live on the beta namespace in @anthropic-ai/sdk 0.70.x.
 * There is no non-beta `messages.parse`, `output_config` does not exist in this
 * version, and `output_format` is what the installed SDK types and sends.
 *
 * Adaptive thinking is deliberately not passed: it is the default on
 * claude-opus-5, and this SDK version has no type for it. Do not add
 * `budget_tokens` — the model rejects it.
 */
interface ParseRequest {
  model: string
  max_tokens: number
  system: string
  messages: { role: "user"; content: string }[]
  output_format: ReturnType<typeof betaZodOutputFormat>
}

type ProposalBatch = { proposals: Omit<RelationProposal, "proposalId">[] }

/**
 * The message-level parsed value, with its name and type taken from the SDK
 * rather than restated here.
 *
 * This matters more than it looks. The field is `parsed_output`; `.parsed`
 * exists only on an individual text content block (`ParsedBetaContentBlock`),
 * and some SDK docstrings show `message.parsed`. Reading the wrong one throws
 * on every otherwise-successful response — and a stub-driven test cannot catch
 * it, because the stub is shaped by whoever wrote the code, so both agree and
 * the error surfaces only on the first live call. Deriving the name from
 * `ParsedBetaMessage` makes the compiler the check instead.
 */
type SdkParsed = Pick<Partial<ParsedBetaMessage<ProposalBatch>>, "parsed_output">

interface ParseResponse extends SdkParsed {
  stop_reason?: string | null
  // Untyped by the SDK, but `parse` spreads the raw message, so it survives
  // when the API sends it.
  stop_details?: { category?: string | null } | null
}

/** The one call this module makes, narrowed so tests can inject a stub. */
export interface ProposalClient {
  beta: { messages: { parse(body: ParseRequest): Promise<ParseResponse> } }
}

const SYSTEM = `You compare a vendor's own claims against independent reports about that vendor.

You receive excerpts, each tagged with a docId and a role:
  vendor_claim  the vendor's own marketing, docs, pricing, or changelog
  independent   status pages, review sites, forums

Propose relations between excerpts:
  contradicts   a vendor claim an independent source contradicts
  corroborates  a vendor claim an independent source confirms
  updates       an independent source reports a newer state than the vendor claim
  unsupported   a specific, checkable vendor claim no excerpt corroborates (set "to" to null)

Rules:
- "quote" MUST be copied character-for-character from the excerpt. Do not fix
  typos, expand contractions, alter whitespace, or trim punctuation. A quote that
  is not a byte-exact substring of its excerpt is discarded before it reaches the
  report, so an approximate quote is worse than no proposal.
- Keep every quote to 40 words or fewer. Quote the specific claim, not the paragraph.
- For contradicts, corroborates, and updates, "from" must be a vendor_claim
  excerpt and "to" an independent excerpt.
- "statement" is a short neutral label for the claim, e.g. "uptime guarantee".
- Only call a vendor claim unsupported if it makes a specific checkable
  assertion. Vague marketing adjectives are not claims.
- "confidence" is 0 to 1. Be honest; low-confidence proposals are filtered out.`

export function buildExcerpts(docs: FetchedDoc[], candidates: Chunk[]): string {
  const byId = new Map(docs.map((d) => [d.docId, d]))
  return candidates
    .map((c) => {
      const doc = byId.get(c.docId)
      if (!doc) return null
      return `--- docId: ${c.docId} | role: ${doc.role} | source: ${doc.label}\n${c.text}`
    })
    .filter((s): s is string => s !== null)
    .join("\n\n")
}

export async function proposeRelations(
  subject: string,
  docs: FetchedDoc[],
  candidates: Chunk[],
  opts: { client?: ProposalClient } = {},
): Promise<RelationProposal[]> {
  // The SDK's `parse` is generic over its params, so it does not match this
  // narrowed interface structurally. One cast, here, at the boundary — the
  // request body below is still checked against ParseRequest.
  //
  // An identity-linked API key is scoped to a workspace and the API rejects it
  // with a 400 unless the request names one. The header is only sent when the
  // variable is set, so an ordinary key is unaffected.
  const workspaceId = process.env["ANTHROPIC_WORKSPACE_ID"]
  const client =
    opts.client ??
    (new Anthropic(
      workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {},
    ) as unknown as ProposalClient)
  const excerpts = buildExcerpts(docs, candidates)

  const request: ParseRequest = {
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Subject: ${subject}\n\nExcerpts:\n\n${excerpts}` }],
    output_format: betaZodOutputFormat(ProposalBatchSchema),
  }

  const response = await client.beta.messages.parse(request)

  // Always check stop_reason before reading content.
  if (response.stop_reason === "refusal") {
    throw new Error(`cartographer: model declined (${response.stop_details?.category ?? "unknown"})`)
  }
  const parsed = response.parsed_output
  if (!parsed) throw new Error("cartographer: structured output failed to parse")

  return parsed.proposals.map((p, i) => ({ ...p, proposalId: `p${i}` }))
}
