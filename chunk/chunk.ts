import type { Chunk } from "../types.js"

const DEFAULT_MAX_CHARS = 700

/**
 * Cut a long paragraph at a newline inside the window when one exists, so a
 * 12k-character HTML blob with hard wraps becomes line-sized chunks instead of
 * mid-sentence 700-character slices. Offsets stay inside `para`.
 */
function nextBreak(para: string, offset: number, maxChars: number): number {
  const limit = Math.min(para.length, offset + maxChars)
  if (limit === para.length) return para.length
  const window = para.slice(offset, limit)
  const nl = window.lastIndexOf("\n")
  if (nl >= Math.floor(maxChars / 4)) return offset + nl + 1
  return limit
}

/**
 * Split a document into chunks carrying offsets into `doc.text`.
 *
 * The invariant every consumer relies on:
 *   doc.text.slice(chunk.start, chunk.end) === chunk.text
 *
 * A running cursor makes this hold even when a paragraph repeats verbatim —
 * searching from index 0 would map both copies to the first occurrence.
 */
export function chunkDoc(doc: { docId: string; text: string }, maxChars = DEFAULT_MAX_CHARS): Chunk[] {
  const chunks: Chunk[] = []
  const text = doc.text
  let cursor = 0
  let n = 0

  for (const para of text.split("\n\n")) {
    if (para.trim().length === 0) {
      cursor += para.length + 2
      continue
    }
    const start = text.indexOf(para, cursor)
    if (start === -1) continue
    cursor = start + para.length

    for (let offset = 0; offset < para.length; ) {
      const end = nextBreak(para, offset, maxChars)
      const piece = para.slice(offset, end)
      if (piece.trim().length === 0) {
        offset = end
        continue
      }
      chunks.push({
        chunkId: `${doc.docId}:${n++}`,
        docId: doc.docId,
        start: start + offset,
        end: start + end,
        text: piece,
      })
      offset = end
    }
  }
  return chunks
}

export function chunkAll(docs: { docId: string; text: string }[], maxChars = DEFAULT_MAX_CHARS): Chunk[] {
  return docs.flatMap((d) => chunkDoc(d, maxChars))
}
