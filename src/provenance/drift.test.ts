import { describe, expect, it } from "vitest"
import type { DocSummary, LedgerRow } from "../types.js"
import { driftHashOf } from "./normalize.js"
import { buildDriftReport, compareDrift, findVanishedQuotes } from "./drift.js"

function prior(over: Partial<DocSummary> = {}): DocSummary {
  const text = over.driftHash === undefined ? "the original page text" : ""
  return {
    docId: "d1", url: "https://a.example", label: "A", role: "independent",
    fetchedAt: "2026-09-01T00:00:00.000Z", stability: "volatile",
    pin: { kind: "snapshot", sha256: "ab" },
    driftHash: driftHashOf(text),
    ...over,
  }
}

describe("compareDrift — one outcome per prior document", () => {
  it("reports unchanged when the drift hash matches", () => {
    const [d] = compareDrift([prior()], [{ docId: "d1", text: "the original page text" }], new Set())
    expect(d!.outcome).toBe("unchanged")
    expect(d!.freshDriftHash).toBe(d!.priorDriftHash)
  })

  it("reports drifted when a volatile document's text changed", () => {
    const [d] = compareDrift([prior()], [{ docId: "d1", text: "the page was edited" }], new Set())
    expect(d!.outcome).toBe("drifted")
    expect(d!.freshDriftHash).not.toBe(d!.priorDriftHash)
  })

  it("reports stability-violated when a declared-stable document changed", () => {
    const [d] = compareDrift(
      [prior({ stability: "stable" })],
      [{ docId: "d1", text: "the page was edited" }], new Set(),
    )
    expect(d!.outcome).toBe("stability-violated")
  })

  it("does not report drift for a change the normalizer strips", () => {
    const [d] = compareDrift(
      [prior({ driftHash: driftHashOf("updated 2026-09-01T00:00:00Z ok") })],
      [{ docId: "d1", text: "updated 2027-01-01T12:00:00Z ok" }], new Set(),
    )
    expect(d!.outcome).toBe("unchanged")
  })

  it("reports unreadable with the fetch's reason when the re-fetch failed", () => {
    const [d] = compareDrift([prior()], [{ docId: "d1", failure: "blocked" }], new Set())
    expect(d!.outcome).toBe("unreadable")
    expect(d!.reason).toBe("blocked")
    expect("freshDriftHash" in d!).toBe(false)
  })

  it("reports from-store for a document read from the snapshot store", () => {
    const [d] = compareDrift([prior({ pin: { kind: "permalink", url: "https://a.example", sha256: "ab" } })], [], new Set(["d1"]))
    expect(d!.outcome).toBe("from-store")
    expect("freshDriftHash" in d!).toBe(false)
  })

  it("reports unreadable when a document is neither fresh nor from the store", () => {
    const [d] = compareDrift([prior()], [], new Set())
    expect(d!.outcome).toBe("unreadable")
    expect(d!.reason).toMatch(/not re-fetched/)
  })

  it("reports unreadable, not drifted, for a document with no recorded drift hash", () => {
    const noBaseline = { ...prior(), driftHash: undefined } as unknown as DocSummary
    const [d] = compareDrift([noBaseline], [{ docId: "d1", text: "any text at all" }], new Set())
    expect(d!.outcome).toBe("unreadable")
    expect(d!.reason).toMatch(/no drift hash recorded/)
    expect("freshDriftHash" in d!).toBe(false)
  })

  it("keeps prior order and carries label, url and stability through", () => {
    const out = compareDrift(
      [prior({ docId: "b", label: "B" }), prior({ docId: "a", label: "A", stability: "stable" })],
      [{ docId: "a", text: "the original page text" }, { docId: "b", text: "the original page text" }],
      new Set(),
    )
    expect(out.map((d) => d.docId)).toEqual(["b", "a"])
    expect(out[1]!.stability).toBe("stable")
  })
})

describe("findVanishedQuotes — a cited span that is no longer on the page", () => {
  const docs = [prior({ docId: "d1", label: "Vendor page" })]
  const row = (text: string, docId = "d1"): LedgerRow => ({
    topic: "uptime", statement: "claims 99.9%", status: "unverified", relation: "unsupported",
    sides: [{ docId, start: 0, end: text.length, text, tag: "EXACT" }],
  })

  it("reports a quote that is no longer an exact substring", () => {
    const out = findVanishedQuotes([row("we guarantee 99.9% uptime")], new Map([["d1", "we now guarantee 99.5% uptime"]]), docs)
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toBe("we guarantee 99.9% uptime")
    expect(out[0]!.label).toBe("Vendor page")
  })

  it("does not report a quote that is still present verbatim", () => {
    expect(findVanishedQuotes([row("we guarantee 99.9% uptime")], new Map([["d1", "intro. we guarantee 99.9% uptime. outro"]]), docs)).toEqual([])
  })

  it("is an exact check — a one-character paraphrase counts as vanished", () => {
    expect(findVanishedQuotes([row("we guarantee 99.9% uptime")], new Map([["d1", "we guarantee 99.9% uptime!"]]), docs)).toHaveLength(0)
    expect(findVanishedQuotes([row("we guarantee 99.9% uptime")], new Map([["d1", "we guarantee 99,9% uptime"]]), docs)).toHaveLength(1)
  })

  it("skips a side whose document has no fresh text, rather than calling it vanished", () => {
    expect(findVanishedQuotes([row("anything")], new Map(), docs)).toEqual([])
  })

  it("checks every side of a two-sided row", () => {
    const two: LedgerRow = {
      topic: "t", statement: "s", status: "divergent", relation: "contradicts",
      sides: [
        { docId: "d1", start: 0, end: 5, text: "alpha", tag: "EXACT" },
        { docId: "d2", start: 0, end: 4, text: "beta", tag: "EXACT" },
      ],
    }
    const both = [prior({ docId: "d1", label: "One" }), prior({ docId: "d2", label: "Two" })]
    const out = findVanishedQuotes([two], new Map([["d1", "alpha here"], ["d2", "gamma"]]), both)
    expect(out.map((v) => v.docId)).toEqual(["d2"])
  })
})

describe("buildDriftReport", () => {
  it("tallies every outcome and the vanished count", () => {
    const docs = compareDrift(
      [prior({ docId: "u" }), prior({ docId: "c" }), prior({ docId: "s", stability: "stable" }), prior({ docId: "x" }), prior({ docId: "p" })],
      [
        { docId: "u", text: "the original page text" },
        { docId: "c", text: "changed" },
        { docId: "s", text: "changed" },
        { docId: "x", failure: "timeout" },
      ],
      new Set(["p"]),
    )
    const r = buildDriftReport("X", "2026-09-01T00:00:00.000Z", docs, [
      { topic: "t", statement: "s", docId: "c", label: "C", text: "gone" },
    ])
    expect(r.summary).toEqual({ fromStore: 1, unchanged: 1, drifted: 1, stabilityViolated: 1, unreadable: 1, vanished: 1 })
    expect(r.subject).toBe("X")
    expect(typeof r.checkedAt).toBe("string")
  })
})
