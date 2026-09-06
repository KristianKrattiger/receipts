import { describe, expect, it } from "vitest"
import { regulatorTargets } from "./regulators.js"

describe("regulatorTargets — a mechanism awaiting a name-derivable regulator", () => {
  // The table is empty on purpose. NHTSA's name-only URL was measured and does
  // not work; the URL that does needs make, model and modelYear, so it lives in
  // plans/tesla-fsd.json instead. See the note on REGULATORS.
  it("returns no targets while the table has no entries", () => {
    expect(regulatorTargets("automotive", "Tesla")).toEqual([])
  })

  // This guarantee has no target to bind to today. It is kept as an executable
  // requirement on whatever entry the table gains next, rather than as four
  // separate assertions looping over an empty array and checking nothing --
  // which is what the previous version of these tests had become.
  it("would mark every target independent and labelled, whenever an entry exists", () => {
    const targets = regulatorTargets("automotive", "Tesla")
    expect(targets.every((t) => t.role === "independent")).toBe(true)
    expect(targets.every((t) => t.label.length > 0)).toBe(true)
  })
})
