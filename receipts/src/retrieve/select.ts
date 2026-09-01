import { idfRelevance } from "./idf.js"
import type { Chunk } from "../types.js"

interface Scored {
  chunk: Chunk
  score: number
}

/**
 * Pick the chunks worth sending to the model.
 *
 * The per-document cap matters as much as the total: without it one verbose
 * marketing page crowds out the status page, and the run silently loses the
 * only source that could contradict anything.
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

  const picked: Scored[] = []
  for (const list of byDoc.values()) {
    list.sort((a, b) => b.score - a.score || a.chunk.start - b.chunk.start)
    picked.push(...list.slice(0, perDoc))
  }

  picked.sort((a, b) => b.score - a.score || a.chunk.chunkId.localeCompare(b.chunk.chunkId))
  return picked
    .slice(0, total)
    .sort((a, b) => a.chunk.chunkId.localeCompare(b.chunk.chunkId))
    .map((s) => s.chunk)
}
