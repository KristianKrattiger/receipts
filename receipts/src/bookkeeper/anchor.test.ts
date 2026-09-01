import { describe, expect, it } from "vitest"
import { findAnchor, MAX_QUOTE_WORDS, wordCount } from "./anchor.js"

const SOURCE = [
  "Acme guarantees 99.99% uptime across all paid plans.",
  "Support responds within one business hour.",
  "Acme guarantees 99.99% uptime across all paid plans.",
].join("\n\n")

describe("findAnchor — admits genuine quotes", () => {
  it("anchors an exact substring and returns round-tripping offsets", () => {
    const r = findAnchor(SOURCE, "Support responds within one business hour.")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(SOURCE.slice(r.start, r.end)).toBe("Support responds within one business hour.")
    expect(r.tag).toBe("EXACT")
  })

  it("tags a quote occurring more than once as AMBIGUOUS rather than picking one", () => {
    const r = findAnchor(SOURCE, "Acme guarantees 99.99% uptime across all paid plans.")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.tag).toBe("AMBIGUOUS")
  })
})

describe("findAnchor — denies fabrications", () => {
  it("denies a plausible paraphrase", () => {
    const r = findAnchor(SOURCE, "Acme promises 99.99% uptime on all paid plans.")
    expect(r).toEqual({ ok: false, code: "ANCHOR_NOT_FOUND" })
  })

  it("denies a quote with a single word altered", () => {
    const r = findAnchor(SOURCE, "Support responds within one business day.")
    expect(r).toEqual({ ok: false, code: "ANCHOR_NOT_FOUND" })
  })

  it("denies a quote whose whitespace differs", () => {
    const r = findAnchor(SOURCE, "Support  responds within one business hour.")
    expect(r).toEqual({ ok: false, code: "ANCHOR_NOT_FOUND" })
  })

  it("denies a quote stitched across a paragraph boundary that does not exist", () => {
    const r = findAnchor(SOURCE, "paid plans. Support responds")
    expect(r).toEqual({ ok: false, code: "ANCHOR_NOT_FOUND" })
  })

  it("denies an empty quote", () => {
    expect(findAnchor(SOURCE, "")).toEqual({ ok: false, code: "ANCHOR_NOT_FOUND" })
  })

  it("denies an over-length quote before searching", () => {
    const long = Array.from({ length: MAX_QUOTE_WORDS + 1 }, (_, i) => `w${i}`).join(" ")
    expect(findAnchor(long, long)).toEqual({ ok: false, code: "QUOTE_TOO_LONG" })
  })
})

describe("wordCount", () => {
  it("counts whitespace-separated words", () => {
    expect(wordCount("  one   two three ")).toBe(3)
  })

  it("counts an empty string as zero", () => {
    expect(wordCount("   ")).toBe(0)
  })
})
