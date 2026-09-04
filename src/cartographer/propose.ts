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
  claimant  the vendor's own marketing, docs, pricing, or changelog
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
- A quote must lie on ONE line. Excerpt text is rendered page text, so a line
  break is a layout edge -- a stat tile, a table cell, a heading, a nav item.
  Quoting across one stitches unrelated fragments into a sentence the source
  never wrote: "7x\\nSafer\\nThan a Human Driver" is three tiles of a graphic,
  not a claim. Such quotes are discarded. If the only version of a claim you can
  find spans a line break, skip it and quote a prose sentence instead.
- A quote must stand on its own as a claim. Include the subject: "7x safer than a
  human driver", not "than a human driver". A bare number like "14,063,269,987" is
  not a claim -- quote "14 billion miles driven" or nothing. Fragments are discarded.
- A name is not a claim. "Full Self-Driving (Supervised)" and "Claude Sonnet 5" name
  a product; they assert nothing. If the claim is that the product exists, costs
  $99/mo, or is available somewhere, quote the words that say so -- "Available for
  $99/mo", "is currently available in select markets". Quote the predicate, not the
  subject. Bare names are discarded.
- For contradicts, corroborates, and updates, "from" must be a claimant
  excerpt and "to" an independent excerpt.
- "statement" is a short neutral label for the claim, e.g. "uptime guarantee".
- Only call a vendor claim unsupported if it makes a specific checkable
  assertion. Vague marketing adjectives are not claims.
- An aggregator is a conduit, not a source. A Hacker News or Reddit result whose
  link points back at the vendor's own domain is the vendor's announcement posted
  elsewhere, NOT independent corroboration. Do not offer it as one; such proposals
  are discarded. A third-party write-up, benchmark or incident report is what
  counts, as is an independent commenter's own words.
- "confidence" is 0 to 1, and it measures ONE thing: how certain you are that the
  two quotes, exactly as written, stand in the relation you are claiming. It is
  not how likely the underlying claim is to be true, not how serious or
  newsworthy the finding is, and not how confident you are that the source is
  reliable. A small, dull, precisely-worded contradiction is high confidence.
  Calibrate against these:
    0.95  the quotes state opposing (or matching) things outright; no reading in
    0.80  the relation holds, but depends on context around the quotes
    0.60  the quotes are about the same thing and point that way, arguably
    0.30  the quotes are about adjacent topics and the link is inference
  Use the whole range and use precise values. Do not cluster on one number.`

/**
 * What each pass is allowed to conclude.
 *
 * A relational pass holds one independent source and can say how it stands
 * against the claimant's words. It cannot say that *nothing* corroborates a
 * claim, because it is not looking at the rest of the corpus — so it is told
 * not to try.
 */
const TASK: Record<ProposalPass["mode"], string> = {
  relational:
    "Task: propose contradicts, corroborates and updates relations between the claimant " +
    "excerpts and the independent excerpts below. Do NOT propose unsupported in this pass: " +
    "you are seeing one independent source, not the whole corpus, so you cannot know whether " +
    "another source corroborates a claim.",
  unsupported:
    "Task: propose ONLY unsupported claims. Every independent excerpt gathered for this " +
    "subject is below. Find specific, checkable claimant claims that none of them corroborates. " +
    "A claim any excerpt below speaks to, for or against, is not unsupported.",
}

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
  opts: { client?: ProposalClient; idPrefix?: string; mode?: ProposalPass["mode"] } = {},
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
    messages: [{
      role: "user",
      content: `Subject: ${subject}\n${TASK[opts.mode ?? "relational"]}\n\nExcerpts:\n\n${excerpts}`,
    }],
    output_format: betaZodOutputFormat(ProposalBatchSchema),
  }

  const response = await client.beta.messages.parse(request)

  // Always check stop_reason before reading content.
  if (response.stop_reason === "refusal") {
    throw new Error(`cartographer: model declined (${response.stop_details?.category ?? "unknown"})`)
  }
  const parsed = response.parsed_output
  if (!parsed) throw new Error("cartographer: structured output failed to parse")

  return parsed.proposals.map((p, i) => ({ ...p, proposalId: `${opts.idPrefix ?? ""}p${i}` }))
}

/**
 * One comparison problem per independent source.
 *
 * A single call over the whole corpus was the ceiling on every ledger this
 * engine produced: three subjects whose corpora differ by two orders of
 * magnitude all came back with 8 or 9 proposals, because the model triages
 * rather than enumerates when handed everything at once. Six independent
 * documents against a claimant corpus is six separate questions, and asking
 * them separately is what makes the yield scale with the corpus.
 *
 * The claimant-only pass is not an afterthought. `admit` has always allowed
 * both sides of a relation to share a role, and a vendor's pricing page
 * contradicting its own docs is the most damning row available — but nothing
 * ever asked the model for one, because the independent sources were always in
 * the same prompt and always more obviously interesting.
 */
export interface ProposalPass {
  /** Stable, and the namespace for this pass's proposal ids. */
  passId: string
  /**
   * `relational` compares two sources. `unsupported` looks for claimant claims
   * nothing corroborates, and must see every independent source at once.
   *
   * Splitting these is not tidiness. "No excerpt corroborates this" is a claim
   * about the whole corpus, so a pass holding one independent document cannot
   * judge it — and when the passes were first fanned the output said so out
   * loud: the Tesla subscription price appeared as `unverified` from one pass
   * and `corroborated` from another, in the same ledger.
   */
  mode: "relational" | "unsupported"
  candidates: Chunk[]
}

export function planPasses(docs: FetchedDoc[], candidates: Chunk[]): ProposalPass[] {
  const roleOf = new Map(docs.map((d) => [d.docId, d.role]))
  const claimant = candidates.filter((c) => roleOf.get(c.docId) === "claimant")
  const independentDocIds = [...new Set(
    candidates.filter((c) => roleOf.get(c.docId) === "independent").map((c) => c.docId),
  )].sort()

  // Nothing to compare against: one pass over whatever was selected, so a
  // corpus with no independent sources still produces unsupported-claim rows
  // rather than an empty ledger.
  if (independentDocIds.length === 0) return [{ passId: "all", mode: "unsupported", candidates }]

  const passes: ProposalPass[] = independentDocIds.map((docId) => ({
    passId: docId,
    mode: "relational" as const,
    candidates: [...claimant, ...candidates.filter((c) => c.docId === docId)],
  }))

  // Self-contradiction needs at least two claimant documents to be possible.
  const claimantDocCount = new Set(claimant.map((c) => c.docId)).size
  if (claimantDocCount >= 2) {
    passes.push({ passId: "self", mode: "relational", candidates: claimant })
  }

  // One pass over everything, for the judgement only the whole corpus can make.
  passes.push({ passId: "unsupported", mode: "unsupported", candidates })

  return passes
}

/** Bounded-concurrency map that keeps results in input order. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i]!, i)
  })
  await Promise.all(workers)
  return results
}

export interface PassFailure {
  passId: string
  message: string
}

export interface FannedProposals {
  proposals: RelationProposal[]
  passes: number
  failures: PassFailure[]
}

/**
 * Run every pass and merge.
 *
 * A pass that fails is reported, not fatal: one refused or malformed response
 * out of six is a partial ledger, and losing the other five to it would be a
 * worse outcome than the missing rows. Proposal ids are namespaced per pass
 * because `proposeRelations` numbers from p0 every time — merging without a
 * namespace silently collides them, and the audit trail is precisely the thing
 * that makes this engine's guarantee checkable.
 */
export async function proposeAcrossPasses(
  subject: string,
  docs: FetchedDoc[],
  candidates: Chunk[],
  opts: { client?: ProposalClient; concurrency?: number } = {},
): Promise<FannedProposals> {
  const passes = planPasses(docs, candidates)
  const failures: PassFailure[] = []

  const perPass = await mapWithLimit(passes, opts.concurrency ?? 3, async (pass) => {
    try {
      return await proposeRelations(subject, docs, pass.candidates, {
        ...(opts.client ? { client: opts.client } : {}),
        idPrefix: `${pass.passId}:`,
        mode: pass.mode,
      })
    } catch (err) {
      failures.push({ passId: pass.passId, message: err instanceof Error ? err.message : String(err) })
      return []
    }
  })

  return { proposals: perPass.flat(), passes: passes.length, failures }
}
