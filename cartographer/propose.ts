import type { Chunk, RelationProposal, SourceRole } from "../types.js"

/** What propose needs of a document: identity, role, label, bytes. */
export type ProposeDoc = { docId: string; role: SourceRole; label: string; text: string }

/** The one call Assay makes. Receipts adapts Anthropic onto this. */
export interface ProposalClient {
  propose(input: { system: string; user: string }): Promise<{
    proposals: Omit<RelationProposal, "proposalId">[]
    stopReason?: string | null
    stopCategory?: string | null
  }>
}

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

export function buildExcerpts(docs: ProposeDoc[], candidates: Chunk[]): string {
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

/**
 * Ask the proposer for relations over these excerpts.
 *
 * A missing client is a caller error: Assay does not construct an SDK client.
 */
export async function proposeRelations(
  subject: string,
  docs: ProposeDoc[],
  candidates: Chunk[],
  opts: { client?: ProposalClient; idPrefix?: string; mode?: ProposalPass["mode"]; system: string },
): Promise<RelationProposal[]> {
  if (!opts.client) throw new Error("assay: ProposalClient is required")
  const excerpts = buildExcerpts(docs, candidates)
  const response = await opts.client.propose({
    system: opts.system,
    user: `Subject: ${subject}\n${TASK[opts.mode ?? "relational"]}\n\nExcerpts:\n\n${excerpts}`,
  })
  if (response.stopReason === "refusal") {
    throw new Error(`cartographer: model declined (${response.stopCategory ?? "unknown"})`)
  }
  if (!response.proposals) throw new Error("cartographer: structured output failed to parse")

  return response.proposals.map((p, i) => ({ ...p, proposalId: `${opts.idPrefix ?? ""}p${i}` }))
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
 * The claimant-only ("self") pass still runs and still asks the model for
 * claimant-vs-claimant relations — but `admit()` now denies every one of
 * them, as `SELF_PAIR` or `TO_NOT_INDEPENDENT` (see
 * docs/superpowers/specs/2026-09-23-side-role-invariant-design.md), so it
 * cannot produce the rows it exists for. It is kept only because removing
 * it is a separate decision — it changes the pass count and what replay
 * reproduces — that has not been made yet: it costs money for nothing
 * right now.
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

export function planPasses(docs: ProposeDoc[], candidates: Chunk[]): ProposalPass[] {
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
  docs: ProposeDoc[],
  candidates: Chunk[],
  opts: { client?: ProposalClient; concurrency?: number; system: string },
): Promise<FannedProposals> {
  const passes = planPasses(docs, candidates)
  const failures: PassFailure[] = []

  const perPass = await mapWithLimit(passes, opts.concurrency ?? 3, async (pass) => {
    try {
      return await proposeRelations(subject, docs, pass.candidates, {
        ...(opts.client ? { client: opts.client } : {}),
        system: opts.system,
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
