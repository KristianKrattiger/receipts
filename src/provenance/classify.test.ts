import { describe, expect, it } from "vitest"
import type { Pin } from "../assay/types.js"
import { classifyStability, stabilityFor } from "./classify.js"

describe("classifyStability", () => {
  it("honours an explicit stable declaration", () => {
    expect(classifyStability("stable")).toBe("stable")
  })

  it("honours an explicit volatile declaration", () => {
    expect(classifyStability("volatile")).toBe("volatile")
  })

  it("defaults an undeclared source to volatile", () => {
    expect(classifyStability(undefined)).toBe("volatile")
  })
})

const H = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
const PERMALINK: Pin = { kind: "permalink", url: "https://www.sec.gov/Archives/edgar/data/1/2/x.htm", sha256: H }
const HASH: Pin = { kind: "hash", sha256: H }

// The single precedence rule shared by provenance/adapt.ts (the live pipeline) and
// provenance/backfill.ts (the backfill), so the two cannot drift the way a
// duplicated six-field object literal already had once in this codebase
// (commit c130835: stability reached only one of three FetchedDoc
// construction sites). This expression itself never actually diverged
// between its two call sites -- the precedent is about the failure shape,
// not a repeat of it.
//
// Declared is one of three values (stable/volatile/undeclared) and Pin is
// one of three kinds (permalink/snapshot/hash), a nine-cell space. The six
// cells crossing permalink and hash with all three declared values are
// covered immediately below. The remaining three, everything crossed with
// `snapshot`, are covered separately below that: a committed blob must never
// promote a document to `stable` on its own, only an explicit declaration
// does.
describe("stabilityFor — declared x pin", () => {
  it("declared stable wins over a permalink pin", () => {
    expect(stabilityFor("stable", PERMALINK)).toBe("stable")
  })

  it("declared stable wins over a hash pin", () => {
    expect(stabilityFor("stable", HASH)).toBe("stable")
  })

  // The critical one: an explicit volatile declaration must beat a permalink
  // pin. The author knows something the URL's shape does not, and silently
  // overriding them would launder an assumption into the ledger.
  it("declared volatile beats a permalink pin", () => {
    expect(stabilityFor("volatile", PERMALINK)).toBe("volatile")
  })

  it("declared volatile beats a hash pin", () => {
    expect(stabilityFor("volatile", HASH)).toBe("volatile")
  })

  it("undeclared is promoted to stable by a permalink pin", () => {
    expect(stabilityFor(undefined, PERMALINK)).toBe("stable")
  })

  it("undeclared stays volatile with only a hash pin", () => {
    expect(stabilityFor(undefined, HASH)).toBe("volatile")
  })
})

describe("stabilityFor — a snapshot pin does not confer stability", () => {
  const snapshotPin = { kind: "snapshot", sha256: "ab" } as const

  it("leaves an undeclared document volatile when its blob is committed", () => {
    expect(stabilityFor(undefined, snapshotPin)).toBe("volatile")
  })

  it("honours an explicit stable declaration alongside a snapshot pin", () => {
    expect(stabilityFor("stable", snapshotPin)).toBe("stable")
  })

  it("honours an explicit volatile declaration alongside a snapshot pin", () => {
    expect(stabilityFor("volatile", snapshotPin)).toBe("volatile")
  })
})
