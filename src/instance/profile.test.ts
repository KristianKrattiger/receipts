import { describe, expect, it } from "vitest"
import { RECEIPTS } from "./profile.js"

// These three properties used to be asserted on the engine's own default
// SYSTEM prompt, in src/assay/cartographer/propose.test.ts. That string is
// now RECEIPTS.system (see profile.ts's doc comment: copied byte for byte),
// and the isolation test forbids engine tests from importing src/instance,
// so the coverage moves here with it rather than being dropped.
describe("the confidence scale is defined, not left to the model", () => {
  // Six of thirteen low-confidence denials across the first three reports sat
  // within 0.1 of the floor, four at exactly 0.45. An undefined scale produces
  // a hedge, and the hedge was being read as a quality signal.
  it("says what the number measures", () => {
    expect(RECEIPTS.system).toContain("stand in the relation you are claiming")
  })

  it("separates certainty about the relation from truth of the claim", () => {
    expect(RECEIPTS.system).toContain("not how likely the underlying claim is to be true")
  })

  // Telling the model its output is filtered invites it to aim at the gate
  // rather than report what it believes, which is the one thing that would make
  // the confidence number useless as a measurement.
  it("does not tell the model that low-confidence proposals are discarded", () => {
    expect(RECEIPTS.system).not.toContain("filtered out")
    expect(RECEIPTS.system).not.toMatch(/0\.5\b/)
  })
})
