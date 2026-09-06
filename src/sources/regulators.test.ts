import { describe, expect, it } from "vitest"
import { regulatorTargets } from "./regulators.js"

describe("regulatorTargets — the regulator is never the claimant", () => {
  it("returns at least one target for a known industry", () => {
    expect(regulatorTargets("automotive", "Tesla").length).toBeGreaterThan(0)
  })

  // A regulator writes about the vendor, never as the vendor. Getting this
  // wrong would file a safety regulator's findings under the company's own
  // claims -- the false attribution the whole ledger exists to prevent.
  it("marks every target independent", () => {
    for (const target of regulatorTargets("automotive", "Tesla")) {
      expect(target.role).toBe("independent")
    }
  })

  it("carries the subject into the url", () => {
    for (const target of regulatorTargets("automotive", "Tesla")) {
      expect(target.url.toLowerCase()).toContain("tesla")
    }
  })

  it("percent-encodes a subject with a space", () => {
    for (const target of regulatorTargets("automotive", "General Motors")) {
      expect(target.url).not.toContain(" ")
      expect(target.url).toContain("General%20Motors")
    }
  })

  // The character that actually breaks a URL rather than merely looking wrong:
  // a bare `&` ends the query parameter and starts another, so the request goes
  // somewhere other than intended. A naive space-only fix passes the test above
  // and still fails this one.
  it("percent-encodes an ampersand, which would otherwise split the query", () => {
    for (const target of regulatorTargets("automotive", "Procter & Gamble")) {
      expect(target.url).toContain("%26")
      expect(target.url).not.toMatch(/[?&]make=[^&]*&(?!amp;)/)
    }
  })

  it("uses only SourceKind values the project already has", () => {
    const known = new Set(["vendor_site", "vendor_docs", "vendor_pricing",
      "status_page", "review_site", "forum", "changelog"])
    for (const target of regulatorTargets("automotive", "Tesla")) {
      expect(known.has(target.kind)).toBe(true)
    }
  })

  it("gives every target a non-empty label", () => {
    for (const target of regulatorTargets("automotive", "Tesla")) {
      expect(target.label.length).toBeGreaterThan(0)
    }
  })
})
