import { idfRelevance } from "./idf.js"
import type { Chunk } from "../types.js"

interface Scored {
  chunk: Chunk
  score: number
}

/**
 * Share of the candidate budget held for the claimant's own words.
 *
 * Every relation needs a claimant `from`, so the claimant side is not one
 * source among many — it is the side without which no row can exist at all.
 * Tesla's corpus is 4k characters of vendor page against 374k of independent
 * writing, a ratio of 1:88, and pure round-robin lets that imbalance decide how
 * much of the vendor's own text the model ever sees. 40% is deliberately more
 * than an equal split would give a single-document claimant: the cost of
 * over-representing it is a few wasted slots, and the cost of starving it is an
 * empty ledger.
 */
export const CLAIMANT_SLOT_SHARE = 0.4

/** Rank within each document, cap its contribution, and order documents stably. */
function rankByDoc(chunks: Chunk[], queryTerms: string[], idf: Map<string, number>, perDoc: number): Scored[][] {
  const byDoc = new Map<string, Scored[]>()
  for (const chunk of chunks) {
    const scored: Scored = { chunk, score: idfRelevance(chunk.text, queryTerms, idf) }
    const list = byDoc.get(chunk.docId)
    if (list) list.push(scored)
    else byDoc.set(chunk.docId, [scored])
  }

  const ranked: Scored[][] = []
  for (const list of byDoc.values()) {
    list.sort((a, b) => b.score - a.score || a.chunk.start - b.chunk.start)
    const capped = list.slice(0, perDoc)
    if (capped.length > 0) ranked.push(capped)
  }
  // Visit documents in a stable order rather than Map insertion order, so the
  // same corpus always yields the same prompt.
  ranked.sort((a, b) => a[0]!.chunk.docId.localeCompare(b[0]!.chunk.docId))
  return ranked
}

/**
 * Round-robin across documents: every source contributes its best chunk before
 * any source contributes its second.
 *
 * A per-document cap alone is not enough. The query terms are the subject's
 * name, which vendor marketing repeats on every line and a status page or forum
 * thread barely mentions — so under a global score sort the vendor's own pages
 * win nearly every slot and the independent sources are evicted outright. A
 * corpus with only one side in it can never yield a contradiction, and the
 * failure is invisible in the output: it just looks like a vendor nobody has
 * complaints about.
 */
function pickRoundRobin(ranked: Scored[][], limit: number): Scored[] {
  const picked: Scored[] = []
  if (limit <= 0) return picked
  for (let rank = 0; picked.length < limit; rank++) {
    let placed = false
    for (const list of ranked) {
      const candidate = list[rank]
      if (!candidate) continue
      picked.push(candidate)
      placed = true
      if (picked.length >= limit) break
    }
    if (!placed) break
  }
  return picked
}

/**
 * Pick the chunks worth sending to the model.
 *
 * Selection is round-robin across documents *within each side*, with a reserved
 * share of the budget for the claimant. Round-robin alone protects the
 * independent sources from a repetitive vendor page; the reservation protects
 * the vendor page from a corpus where the independent side outweighs it ninety
 * to one. Both failures produce the same symptom — a corpus with only one side
 * in it, which can never yield a contradiction.
 *
 * Unused budget flows both ways: a claimant that cannot fill its reservation
 * releases the rest to the independent side, and a thin independent side hands
 * its remainder back.
 */
export function selectCandidates(
  chunks: Chunk[],
  queryTerms: string[],
  idf: Map<string, number>,
  opts: { perDoc?: number; total?: number; claimantDocIds?: ReadonlySet<string> } = {},
): Chunk[] {
  const perDoc = opts.perDoc ?? 8
  const total = opts.total ?? 40
  const claimantDocIds = opts.claimantDocIds

  const order = (picked: Scored[]) =>
    picked
      .sort((a, b) => a.chunk.chunkId.localeCompare(b.chunk.chunkId))
      .map((s) => s.chunk)

  // Without role information, behave exactly as before: one round-robin over
  // everything. Callers that cannot say which documents are the claimant's
  // should not silently get a different selection.
  if (claimantDocIds === undefined || claimantDocIds.size === 0) {
    return order(pickRoundRobin(rankByDoc(chunks, queryTerms, idf, perDoc), total))
  }

  const claimantChunks = chunks.filter((c) => claimantDocIds.has(c.docId))
  const reserve = Math.ceil(total * CLAIMANT_SLOT_SHARE)

  // The per-document cap and the reservation otherwise fight, and the cap wins
  // silently. It exists to stop one document dominating its *side* — but a
  // corpus with a single claimant page has a claimant side of one document,
  // where the cap does not restrain anything, it just leaves the reservation
  // unfillable. Tesla is exactly that case: one vendor page, a cap of 12, and a
  // reservation of 32 that could never draw more than 12.
  const claimantDocCount = new Set(claimantChunks.map((c) => c.docId)).size
  const claimantPerDoc = claimantDocCount === 0
    ? perDoc
    : Math.max(perDoc, Math.ceil(reserve / claimantDocCount))

  const claimantRanked = rankByDoc(claimantChunks, queryTerms, idf, claimantPerDoc)
  const otherRanked = rankByDoc(
    chunks.filter((c) => !claimantDocIds.has(c.docId)), queryTerms, idf, perDoc,
  )

  const claimant = pickRoundRobin(claimantRanked, reserve)
  const other = pickRoundRobin(otherRanked, total - claimant.length)

  // The independent side could not fill what was left; hand it back rather than
  // sending a short prompt. pickRoundRobin is deterministic, so asking for a
  // larger prefix and dropping what we already have yields exactly the extras.
  const shortfall = total - claimant.length - other.length
  const extra = shortfall > 0
    ? pickRoundRobin(claimantRanked, claimant.length + shortfall).slice(claimant.length)
    : []

  return order([...claimant, ...other, ...extra])
}
