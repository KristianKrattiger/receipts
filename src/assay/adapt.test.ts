import { describe, expect, it } from "vitest"
import type { Corpus, FetchedDoc } from "../types.js"
import { toPinnedCorpus } from "./adapt.js"

function doc(over: Partial<FetchedDoc> = {}): FetchedDoc {
  return {
    docId: "d1", url: "https://example.com", label: "Example",
    role: "claimant", kind: "vendor_site", fetchedAt: "2026-09-09T00:00:00.000Z",
    title: "Example", text: "hello world", ...over,
  }
}

describe("toPinnedCorpus", () => {
  it("pins every doc by the sha256 of its text", () => {
    const corpus: Corpus = { subject: "X", docs: [doc()], failures: [] }
    const pinned = toPinnedCorpus(corpus)
    // SHA-256 of "hello world"
    const expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
    expect(pinned.docs[0]!.pin).toEqual({ kind: "hash", sha256: expected })
  })

  it("defaults every doc to volatile", () => {
    const pinned = toPinnedCorpus({ subject: "X", docs: [doc({ kind: "vendor_docs" })], failures: [] })
    expect(pinned.docs[0]!.stability).toBe("volatile")
  })

  it("carries subject, failures and labels through", () => {
    const corpus: Corpus = {
      subject: "X", docs: [doc()],
      failures: [{ url: "u", label: "G2", reason: "blocked", detail: "no" }],
      labels: { claimant: "Vendor", independent: "Independent" },
    }
    const pinned = toPinnedCorpus(corpus)
    expect(pinned.subject).toBe("X")
    expect(pinned.failures).toHaveLength(1)
    expect(pinned.labels).toEqual({ claimant: "Vendor", independent: "Independent" })
  })

  it("gives two docs with identical text the same pin", () => {
    const pinned = toPinnedCorpus({
      subject: "X", docs: [doc({ docId: "a" }), doc({ docId: "b" })], failures: [],
    })
    expect(pinned.docs[0]!.pin.sha256).toBe(pinned.docs[1]!.pin.sha256)
  })

  it("gives two docs with different text different pins", () => {
    const pinned = toPinnedCorpus({
      subject: "X",
      docs: [doc({ docId: "a", text: "hello world" }), doc({ docId: "b", text: "goodbye world" })],
      failures: [],
    })
    expect(pinned.docs[0]!.pin.sha256).not.toBe(pinned.docs[1]!.pin.sha256)
  })

  it("omits labels when the corpus has none", () => {
    const pinned = toPinnedCorpus({ subject: "X", docs: [doc()], failures: [] })
    expect("labels" in pinned).toBe(false)
  })

  // Amendment 1: `via` is the one FetchedDoc provenance field anything
  // downstream reads, and dropping it silently loses the "(via api)" marker.
  it("carries via through to the pinned doc", () => {
    const pinned = toPinnedCorpus({
      subject: "X", docs: [doc({ via: "api" })], failures: [],
    })
    expect(pinned.docs[0]!.via).toBe("api")
  })

  it("leaves via absent as a key when the fetched doc had none", () => {
    const pinned = toPinnedCorpus({ subject: "X", docs: [doc()], failures: [] })
    expect("via" in pinned.docs[0]!).toBe(false)
  })

  it("does not carry sessionId or egress onto the pinned doc", () => {
    const pinned = toPinnedCorpus({
      subject: "X",
      docs: [doc({ sessionId: "s1", egress: { requested: "smart", stealth: false } })],
      failures: [],
    })
    expect("sessionId" in pinned.docs[0]!).toBe(false)
    expect("egress" in pinned.docs[0]!).toBe(false)
  })
})

const TESLA_10K =
  "https://www.sec.gov/Archives/edgar/data/1318605/000162828025003063/tsla-20241231.htm"

describe("toPinnedCorpus composes the provenance layer", () => {
  it("pins a permanent url as a permalink and promotes it to stable", () => {
    const pinned = toPinnedCorpus({
      subject: "X", docs: [doc({ url: TESLA_10K })], failures: [],
    })
    expect(pinned.docs[0]!.pin.kind).toBe("permalink")
    expect(pinned.docs[0]!.stability).toBe("stable")
  })

  it("leaves an ordinary url a hash pin and volatile", () => {
    const pinned = toPinnedCorpus({ subject: "X", docs: [doc()], failures: [] })
    expect(pinned.docs[0]!.pin.kind).toBe("hash")
    expect(pinned.docs[0]!.stability).toBe("volatile")
  })

  it("honours an explicit stable declaration on an ordinary url", () => {
    const pinned = toPinnedCorpus({
      subject: "X", docs: [doc({ stability: "stable" })], failures: [],
    })
    expect(pinned.docs[0]!.stability).toBe("stable")
    expect(pinned.docs[0]!.pin.kind).toBe("hash")
  })

  it("does not let a permalink override an explicit volatile declaration", () => {
    const pinned = toPinnedCorpus({
      subject: "X", docs: [doc({ url: TESLA_10K, stability: "volatile" })], failures: [],
    })
    expect(pinned.docs[0]!.stability).toBe("volatile")
  })

  it("computes driftHash over the normalized text, not the raw text", () => {
    const a = toPinnedCorpus({ subject: "X", docs: [doc({ text: "ok at 2026-09-10T00:00:00Z" })], failures: [] })
    const b = toPinnedCorpus({ subject: "X", docs: [doc({ text: "ok at 2027-01-01T12:00:00Z" })], failures: [] })
    expect(a.docs[0]!.driftHash).toBe(b.docs[0]!.driftHash)
    expect(a.docs[0]!.pin.sha256).not.toBe(b.docs[0]!.pin.sha256)
  })
})
