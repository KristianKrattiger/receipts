import { describe, expect, it } from "vitest"
import { PROMPT_TIERS, receipts } from "./profile.js"

describe.each(PROMPT_TIERS)("the %s prompt: the confidence scale is defined, not left to the model", (tier) => {
  const system = receipts(tier).system
  // Six of thirteen low-confidence denials across the first three reports sat
  // within 0.1 of the floor, four at exactly 0.45. An undefined scale produces
  // a hedge, and the hedge was being read as a quality signal.
  it("says what the number measures", () => {
    expect(system).toMatch(/stand in the relation you are claiming|stands in the relation you claim/)
  })
  it("separates certainty about the relation from truth of the claim", () => {
    expect(system).toMatch(/not how likely the underlying claim is to be true|not whether the claim is true/)
  })
  // Telling the model its output is filtered invites it to aim at the gate.
  it("does not tell the model that low-confidence proposals are discarded", () => {
    expect(system).not.toContain("filtered out")
    expect(system).not.toMatch(/0\.5\b/)
  })
})

describe("receipts(tier)", () => {
  it("differs between tiers only in the system prompt", () => {
    const a = receipts("frontier")
    const b = receipts("small")
    expect(a.system).not.toBe(b.system)
    expect({ ...a, system: "" }).toEqual({ ...b, system: "" })
    expect(a.name).toBe("receipts")
  })
  it("keeps the frontier prompt byte-identical to the string Tesla's cache was keyed on", () => {
    expect(receipts("frontier").system.length).toBe(3572)
    expect(receipts("frontier").system.startsWith("You compare a vendor's own claims against independent reports about that vendor.")).toBe(true)
  })
  it("teaches the line-break rule by shape, not by a copyable literal", () => {
    const s = receipts("small").system
    // 2026-09-22 qwen2.5:14b, runs:2, frontier vs small: 16 of the small
    // tier's 17 INCOHERENT_QUOTE denials were the model quoting this literal
    // Bad example back verbatim. Naming a specific forbidden string makes it
    // the most salient quotable text in the prompt. Describe the shape.
    expect(s).not.toContain("7x")
    expect(s).not.toContain("Safer")
    expect(s).toMatch(/heading|stat tile/)
    expect(s).toMatch(/25 words/)
    expect(s.length).toBeLessThan(receipts("frontier").system.length / 2)
  })
  it("requires an actual conflict for a claimant-vs-claimant pair, on a different document", () => {
    const s = receipts("small").system
    // Same comparison: 3 of the small tier's admissions were SELF_PAIR (a
    // document paired with itself), and several admitted claimant-vs-claimant
    // rows carried one-word statements ("cameras", "accidents") -- "two pages
    // disagree" was read as "two pages differ".
    expect(s).toMatch(/different document/)
    expect(s).toMatch(/never.*same docId|same docId.*never/)
  })
})
