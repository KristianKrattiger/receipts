import { describe, expect, it } from "vitest"
import { stripConfidencePrefix, viaSuffix } from "./via.js"

describe("viaSuffix — a row says how it was read", () => {
  it("marks an API-read document", () => {
    expect(viaSuffix("api")).toBe(" (via api)")
  })

  // The browser fan is the default path and every existing row uses it.
  // Annotating those would add noise to every ledger this project has published.
  it("says nothing for a browser-read document", () => {
    expect(viaSuffix("browser")).toBe("")
  })

  it("says nothing when provenance was not recorded", () => {
    expect(viaSuffix(undefined)).toBe("")
  })
})

describe("stripConfidencePrefix — a near-miss statement already carries its own score", () => {
  // admit.ts formats a denial's detail as `${confidence} — ${topic}: ${statement}`,
  // so a Refusal.nearMiss statement already opens with the number every renderer
  // also prints beside it via `confidence.toFixed(2)`. Left unstripped, a
  // renderer would show the score twice: "0.42  0.42 — topic: the claim".
  it("strips the confidence prefix admit.ts's detail format prepends", () => {
    expect(stripConfidencePrefix("0.42 — pricing: unlimited support included"))
      .toBe("pricing: unlimited support included")
  })

  it("passes a statement carrying no confidence prefix through unchanged", () => {
    expect(stripConfidencePrefix("pricing: unlimited support included"))
      .toBe("pricing: unlimited support included")
  })

  // The strip must anchor to the start and fire once, not hunt for any em dash
  // -- a claim that itself contains one must survive intact past the prefix.
  it("does not over-strip when the claim text itself contains an em dash", () => {
    expect(stripConfidencePrefix("0.9 — pricing: our claim — which matters — holds"))
      .toBe("pricing: our claim — which matters — holds")
  })
})
