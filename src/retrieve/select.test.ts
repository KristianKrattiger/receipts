import { describe, expect, it } from "vitest"
import { buildIdf, tokenize } from "./idf.js"
import { CLAIMANT_SLOT_SHARE, selectCandidates } from "./select.js"
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

describe("selectCandidates — the claimant side is reserved, not merely included", () => {
  // Tesla's shape: one small vendor page against six large independent
  // documents. Pure round-robin gives the vendor one slot in seven, and every
  // relation needs a claimant side, so the ledger is capped before it starts.
  const lopsided = [
    ...Array.from({ length: 30 }, (_, i) => chunk("vendor", i, "acme uptime guarantee")),
    ...Array.from({ length: 6 }, (_, d) =>
      Array.from({ length: 30 }, (_, i) => chunk(`ind${d}`, i, "acme uptime incident")),
    ).flat(),
  ]
  const terms = tokenize("acme uptime")
  const idf = buildIdf([])
  const claimantDocIds = new Set(["vendor"])

  it("holds at least the reserved share for the claimant", () => {
    const picked = selectCandidates(lopsided, terms, idf, { total: 40, perDoc: 8, claimantDocIds })
    const claimant = picked.filter((c) => c.docId === "vendor")
    expect(claimant.length).toBeGreaterThanOrEqual(Math.floor(40 * CLAIMANT_SLOT_SHARE))
  })

  it("still fills the budget", () => {
    expect(selectCandidates(lopsided, terms, idf, { total: 40, perDoc: 8, claimantDocIds }))
      .toHaveLength(40)
  })

  it("does not let the reservation evict the independent side entirely", () => {
    const picked = selectCandidates(lopsided, terms, idf, { total: 40, perDoc: 8, claimantDocIds })
    expect(picked.some((c) => c.docId.startsWith("ind"))).toBe(true)
  })

  // A claimant that cannot fill its reservation must not shrink the prompt.
  it("releases an unfilled claimant reservation to the independent side", () => {
    const thin = [
      chunk("vendor", 0, "acme uptime guarantee"),
      ...Array.from({ length: 60 }, (_, i) => chunk("ind0", i, "acme uptime incident")),
    ]
    const picked = selectCandidates(thin, terms, idf, { total: 20, perDoc: 60, claimantDocIds })
    expect(picked).toHaveLength(20)
    expect(picked.filter((c) => c.docId === "vendor")).toHaveLength(1)
  })

  // And a thin independent side must hand its remainder back rather than
  // sending a short prompt.
  it("hands an unfilled independent budget back to the claimant", () => {
    const thin = [
      ...Array.from({ length: 60 }, (_, i) => chunk("vendor", i, "acme uptime guarantee")),
      chunk("ind0", 0, "acme uptime incident"),
    ]
    const picked = selectCandidates(thin, terms, idf, { total: 20, perDoc: 60, claimantDocIds })
    expect(picked).toHaveLength(20)
    expect(picked.filter((c) => c.docId === "vendor")).toHaveLength(19)
  })

  // Callers that cannot say which side is which must not silently get a
  // different selection than before.
  it("falls back to plain round-robin when no claimant is named", () => {
    const withRoles = selectCandidates(lopsided, terms, idf, { total: 40, perDoc: 8, claimantDocIds })
    const without = selectCandidates(lopsided, terms, idf, { total: 40, perDoc: 8 })
    expect(without).toHaveLength(40)
    expect(without).not.toEqual(withRoles)
  })

  it("is deterministic", () => {
    const a = selectCandidates(lopsided, terms, idf, { total: 40, perDoc: 8, claimantDocIds })
    const b = selectCandidates(lopsided, terms, idf, { total: 40, perDoc: 8, claimantDocIds })
    expect(a).toEqual(b)
  })
})

// The cap exists to stop one document dominating its side. A single-document
// claimant *is* its side, so the cap restrains nothing there and only leaves
// the reservation unfillable.
describe("selectCandidates — the per-document cap must not eat the reservation", () => {
  const terms = tokenize("acme uptime")
  const idf = buildIdf([])

  it("lets a lone claimant document fill the whole reservation", () => {
    const chunks = [
      ...Array.from({ length: 30 }, (_, i) => chunk("vendor", i, "acme uptime guarantee")),
      ...Array.from({ length: 30 }, (_, i) => chunk("ind0", i, "acme uptime incident")),
    ]
    const picked = selectCandidates(chunks, terms, idf, {
      total: 40, perDoc: 8, claimantDocIds: new Set(["vendor"]),
    })
    expect(picked.filter((c) => c.docId === "vendor")).toHaveLength(16)
  })

  // The independent side keeps its cap, so no single independent document can
  // crowd the others out.
  it("still caps each independent document", () => {
    const chunks = [
      ...Array.from({ length: 30 }, (_, i) => chunk("vendor", i, "acme uptime guarantee")),
      ...Array.from({ length: 30 }, (_, i) => chunk("ind0", i, "acme uptime incident")),
      ...Array.from({ length: 30 }, (_, i) => chunk("ind1", i, "acme uptime outage")),
    ]
    const picked = selectCandidates(chunks, terms, idf, {
      total: 40, perDoc: 8, claimantDocIds: new Set(["vendor"]),
    })
    expect(picked.filter((c) => c.docId === "ind0").length).toBeLessThanOrEqual(8)
  })
})
