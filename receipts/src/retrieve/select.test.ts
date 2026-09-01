import { describe, expect, it } from "vitest"
import { buildIdf } from "./idf.js"
import { selectCandidates } from "./select.js"
import type { Chunk } from "../types.js"

function chunk(docId: string, n: number, text: string): Chunk {
  return { chunkId: `${docId}:${n}`, docId, start: n * 100, end: n * 100 + text.length, text }
}

const CHUNKS: Chunk[] = [
  ...Array.from({ length: 6 }, (_, i) => chunk("wordy", i, "uptime guarantee filler prose")),
  chunk("terse", 0, "uptime incident report"),
  chunk("noise", 0, "unrelated cooking recipe"),
]

const IDF = buildIdf(CHUNKS.map((c) => ({ text: c.text })))

describe("selectCandidates", () => {
  it("caps how many chunks a single document contributes", () => {
    const picked = selectCandidates(CHUNKS, ["uptime"], IDF, { perDoc: 2, total: 50 })
    expect(picked.filter((c) => c.docId === "wordy")).toHaveLength(2)
  })

  it("keeps a terse document represented against a verbose one", () => {
    const picked = selectCandidates(CHUNKS, ["uptime"], IDF, { perDoc: 2, total: 50 })
    expect(picked.map((c) => c.docId)).toContain("terse")
  })

  it("respects the total cap", () => {
    expect(selectCandidates(CHUNKS, ["uptime"], IDF, { perDoc: 10, total: 3 })).toHaveLength(3)
  })

  // The per-doc cap only makes room; it does not guarantee representation once
  // the total binds. Here the vendor page repeats the subject's name on every
  // line and the status page does not, so a global score sort fills both slots
  // with vendor chunks and drops the only source that could contradict them.
  it("keeps an independent source represented when the total cap binds", () => {
    const skewed: Chunk[] = [
      ...Array.from({ length: 4 }, (_, i) =>
        chunk("vendor", i, "acme guarantees acme uptime on every acme plan"),
      ),
      chunk("status", 0, "four uptime incidents were recorded"),
    ]
    const idf = buildIdf(skewed.map((c) => ({ text: c.text })))
    const picked = selectCandidates(skewed, ["acme", "uptime"], idf, { perDoc: 4, total: 2 })
    expect(picked.map((c) => c.docId)).toContain("status")
  })

  it("returns chunks sorted by chunkId for stable prompts", () => {
    const picked = selectCandidates(CHUNKS, ["uptime"], IDF, { perDoc: 10, total: 50 })
    const ids = picked.map((c) => c.chunkId)
    expect(ids).toEqual([...ids].sort())
  })

  it("returns an empty array for an empty corpus", () => {
    expect(selectCandidates([], ["uptime"], IDF)).toEqual([])
  })
})
