import type { Chunk, FetchedDoc } from "../types.js"

const DEFAULT_MAX_CHARS = 700

/**
 * Split a document into chunks carrying offsets into `doc.text`.
 *
 * The invariant every consumer relies on:
 *   doc.text.slice(chunk.start, chunk.end) === chunk.text
 *
 * A running cursor makes this hold even when a paragraph repeats verbatim —
 * searching from index 0 would map both copies to the first occurrence.
 */
export function chunkDoc(doc: FetchedDoc, maxChars = DEFAULT_MAX_CHARS): Chunk[] {
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

    for (let offset = 0; offset < para.length; offset += maxChars) {
      const piece = para.slice(offset, offset + maxChars)
      if (piece.trim().length === 0) continue
      chunks.push({
        chunkId: `${doc.docId}:${n++}`,
        docId: doc.docId,
        start: start + offset,
        end: start + offset + piece.length,
        text: piece,
      })
    }
  }
  return chunks
}

export function chunkAll(docs: FetchedDoc[], maxChars = DEFAULT_MAX_CHARS): Chunk[] {
  return docs.flatMap((d) => chunkDoc(d, maxChars))
}
