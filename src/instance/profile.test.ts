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
  it("gives the small prompt the example the 7B model got wrong, and a tighter cap", () => {
    const s = receipts("small").system
    expect(s).toContain("7x\\nSafer\\nThan a Human Driver")
    expect(s).toMatch(/25 words/)
    expect(s.length).toBeLessThan(receipts("frontier").system.length / 2)
  })
})
