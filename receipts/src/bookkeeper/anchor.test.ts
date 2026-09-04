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

  // The content guard must not over-reject: a quote in a non-Latin script
  // carries letters and is a perfectly good citation.
  it("still admits a quote in a non-Latin script", () => {
    const source = "東京のサーバーは稼働しています。"
    const r = findAnchor(source, "東京のサーバー")
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(source.slice(r.start, r.end)).toBe("東京のサーバー")
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
    expect(findAnchor(SOURCE, "")).toEqual({ ok: false, code: "INCOHERENT_QUOTE" })
  })

  // No letters, so nothing is being claimed — caught before the search.
  it("denies a whitespace-only quote", () => {
    expect(findAnchor(SOURCE, " ")).toEqual({ ok: false, code: "INCOHERENT_QUOTE" })
  })

  it("denies a punctuation-only quote", () => {
    expect(findAnchor(SOURCE, ".")).toEqual({ ok: false, code: "INCOHERENT_QUOTE" })
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

describe("findAnchor — a span must read as a claim", () => {
  // Verbatim from the Tesla FSD page in fixtures/tesla-fsd.json. innerText
  // flattened a visual stat grid; the number is real but says nothing on its
  // own, and it was rendered under an UNVERIFIED heading as if it were evidence.
  it("denies a bare number", () => {
    const src = "Full Self-Driving has now covered 14,063,269,987 miles worldwide."
    expect(findAnchor(src, "14,063,269,987")).toEqual({ ok: false, code: "INCOHERENT_QUOTE" })
  })

  it("denies a chopped comparison with no subject", () => {
    const src = "7x Safer Than a Human Driver When FSD (Supervised) Is Engaged5"
    const frag = "Than a Human Driver When FSD (Supervised) Is Engaged5"
    expect(findAnchor(src, frag)).toEqual({ ok: false, code: "INCOHERENT_QUOTE" })
  })

  it("admits the same claim when the subject is included", () => {
    const src = "7x Safer Than a Human Driver When FSD (Supervised) Is Engaged5"
    const r = findAnchor(src, "7x Safer Than a Human Driver When FSD (Supervised) Is Engaged5")
    expect(r.ok).toBe(true)
  })

  it("leaves a legitimate quote that merely contains a number alone", () => {
    const src = "Available for $99/mo with no long-term contract."
    const r = findAnchor(src, "Available for $99/mo")
    expect(r.ok).toBe(true)
  })

  it("does not reject a quote that legitimately opens with When", () => {
    const src = "When enabled, your vehicle will drive you almost anywhere."
    const r = findAnchor(src, "When enabled, your vehicle will drive you almost anywhere.")
    expect(r.ok).toBe(true)
  })

  // Verbatim from fixtures/tesla-fsd.json. innerText renders a three-tile
  // safety graphic as three lines; the stitched span anchors exactly and reads
  // as a sentence Tesla never wrote on one line.
  it("denies a span stitched across a stat grid", () => {
    const src = "Get in and go.\n7x\nSafer\nThan a Human Driver When FSD (Supervised) Is Engaged\nOrder now"
    const quote = "7x\nSafer\nThan a Human Driver When FSD (Supervised) Is Engaged"
    expect(findAnchor(src, quote)).toEqual({ ok: false, code: "INCOHERENT_QUOTE" })
  })

  // Same defect on a different vendor: four cells of a pricing table.
  it("denies a span stitched across pricing-table cells", () => {
    const src = "Service Requests\nBeta\n1M requests / month included\nStarting at $0.50 per 1M"
    expect(findAnchor(src, src)).toEqual({ ok: false, code: "INCOHERENT_QUOTE" })
  })

  // The boundary must not swallow ordinary prose: innerText keeps a flowing
  // paragraph on one line however it wrapped on screen, so a legitimate quote
  // has no newline to trip over.
  it("still admits a long single-line quote", () => {
    const src = "When enabled, your vehicle will drive you almost anywhere with your active supervision, requiring minimal intervention."
    const r = findAnchor(src, src)
    expect(r.ok).toBe(true)
  })

  it("looks past a leading quotation mark to the first real word", () => {
    const src = 'The report said "which of these holds up" is the wrong question.'
    // The quote mark is stripped, so the opener check sees "which" — a relative
    // clause with no head — and denies it.
    expect(findAnchor(src, '"which of these holds up"')).toEqual({ ok: false, code: "INCOHERENT_QUOTE" })
  })
})
