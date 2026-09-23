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
  it("keeps 'to' independent-only, like the frontier prompt", () => {
    const s = receipts("small").system
    // The claimant-vs-claimant allowance was tried twice (2026-09-22,
    // 2026-09-23, both qwen2.5:14b, runs:2) and produced zero genuine
    // findings both times: six SELF_PAIR self-contradictions of the same
    // document on the second attempt (after the first attempt's wording was
    // tightened to "a different document" and "never the same docId" -- the
    // explicit forbidding made the self-pairing more salient, not less, the
    // same failure mode as the Bad-quote literal), plus vague one-two-word
    // "conflicts" ("360-degree visibility", "safety standards") that were
    // not conflicts. The frontier prompt never offered this pairing.
    expect(s).not.toMatch(/two of the vendor|different document/)
  })
})
