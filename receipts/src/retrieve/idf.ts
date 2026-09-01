/**
 * IDF-weighted lexical relevance over the fetched corpus.
 *
 * Two consumers: the candidate pre-filter that keeps the LLM call small, and
 * the admission gate's relevance check. The floor is borrowed from GIN's
 * DIVERGENCE_IDF_FLOOR — one *distinctive* shared word is enough, a generic one
 * is not, which is what lets genuinely related passages sharing little
 * vocabulary still qualify.
 */
export const DIVERGENCE_IDF_FLOOR = 0.13

export function tokenize(s: string): string[] {
  // Unicode-aware: an ASCII-only class fragments accented Latin ("café" ->
  // ["caf"]) and drops non-Latin scripts entirely. Accented proper nouns are
  // exactly the distinctive, high-IDF terms this module exists to reward.
  return s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

export function buildIdf(docs: { text: string }[]): Map<string, number> {
  const df = new Map<string, number>()
  for (const doc of docs) {
    for (const term of new Set(tokenize(doc.text))) {
      df.set(term, (df.get(term) ?? 0) + 1)
    }
  }
  const n = Math.max(docs.length, 1)
  const idf = new Map<string, number>()
  for (const [term, count] of df) {
    idf.set(term, Math.log((n + 1) / (count + 0.5)))
  }
  return idf
}

/** Fraction of the query's IDF mass present in `text`. Range 0..1. */
export function idfRelevance(
  text: string,
  queryTerms: string[],
  idf: Map<string, number>,
): number {
  if (queryTerms.length === 0) return 0
  const present = new Set(tokenize(text))
  let matched = 0
  let total = 0
  for (const term of queryTerms) {
    // A term absent from the corpus is maximally distinctive, not weightless.
    const weight = idf.get(term) ?? Math.log(2)
    total += weight
    if (present.has(term)) matched += weight
  }
  return total === 0 ? 0 : matched / total
}
