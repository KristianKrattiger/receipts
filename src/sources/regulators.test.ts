import { describe, expect, it } from "vitest"
import { regulatorTargets } from "./regulators.js"

describe("regulatorTargets — a mechanism awaiting a name-derivable regulator", () => {
  // The table is empty on purpose. NHTSA's name-only URL was measured and does
  // not work; the URL that does needs make, model and modelYear, so it lives in
  // plans/tesla-fsd.json instead. See the note on REGULATORS.
  //
  // The "every target independent and labelled" guarantee has no target to
  // bind to today: with the table empty, `.every()` over `[]` is vacuously
  // true for any predicate, so a second test asserting it could never fail
  // and was removed rather than kept as a test that cannot fail.
  it("returns no targets while the table has no entries", () => {
    expect(regulatorTargets("automotive", "Tesla")).toEqual([])
  })
})
