import { idfRelevance } from "./idf.js"
import type { Chunk } from "../types.js"

interface Scored {
  chunk: Chunk
  score: number
}

/**
 * Pick the chunks worth sending to the model.
 *
 * Selection is round-robin across documents: every source contributes its best
 * chunk before any source contributes its second.
 *
 * A per-document cap alone is not enough. The query terms are the subject's
 * name, which vendor marketing repeats on every line and a status page or forum
 * thread barely mentions — so under a global score sort the vendor's own pages
 * win nearly every slot and the independent sources are evicted outright. A
 * corpus with only one side in it can never yield a contradiction, and the
 * failure is invisible in the output: it just looks like a vendor nobody has
 * complaints about.
 */
export function selectCandidates(
  chunks: Chunk[],
  queryTerms: string[],
  idf: Map<string, number>,
  opts: { perDoc?: number; total?: number } = {},
): Chunk[] {
  const perDoc = opts.perDoc ?? 8
  const total = opts.total ?? 40

  const byDoc = new Map<string, Scored[]>()
  for (const chunk of chunks) {
    const scored: Scored = { chunk, score: idfRelevance(chunk.text, queryTerms, idf) }
    const list = byDoc.get(chunk.docId)
    if (list) list.push(scored)
    else byDoc.set(chunk.docId, [scored])
  }

  // Rank within each document, then cap its contribution.
  const ranked: Scored[][] = []
  for (const list of byDoc.values()) {
    list.sort((a, b) => b.score - a.score || a.chunk.start - b.chunk.start)
    const capped = list.slice(0, perDoc)
    if (capped.length > 0) ranked.push(capped)
  }
  // Visit documents in a stable order rather than Map insertion order, so the
  // same corpus always yields the same prompt.
  ranked.sort((a, b) => a[0]!.chunk.docId.localeCompare(b[0]!.chunk.docId))

  const picked: Scored[] = []
  for (let rank = 0; picked.length < total; rank++) {
    let placed = false
    for (const list of ranked) {
      const candidate = list[rank]
      if (!candidate) continue
      picked.push(candidate)
      placed = true
      if (picked.length >= total) break
    }
    if (!placed) break
  }

  return picked
    .sort((a, b) => a.chunk.chunkId.localeCompare(b.chunk.chunkId))
    .map((s) => s.chunk)
}
