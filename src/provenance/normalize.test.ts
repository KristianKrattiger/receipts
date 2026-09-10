import { describe, expect, it } from "vitest"
import { driftHashOf, normalizeForDrift } from "./normalize.js"

describe("normalizeForDrift — strips what only a clock changed", () => {
  it("strips ISO-8601 timestamps", () => {
    const a = "Generated at 2026-09-10T04:12:33.219Z. Uptime is good."
    const b = "Generated at 2026-09-11T22:01:04.000Z. Uptime is good."
    expect(normalizeForDrift(a)).toBe(normalizeForDrift(b))
  })

  it("strips relative times", () => {
    expect(normalizeForDrift("posted 3 hours ago")).toBe(normalizeForDrift("posted 41 minutes ago"))
  })

  it("strips long digit runs", () => {
    expect(normalizeForDrift("req 1757478753123")).toBe(normalizeForDrift("req 9999999999999"))
  })

  it("strips a 10-digit epoch-seconds value", () => {
    expect(normalizeForDrift("seen at 1757478753")).toBe(normalizeForDrift("seen at 9999999999"))
  })

  it("strips long hex nonces", () => {
    const a = "csrf=0a1b2c3d4e5f60718293a4b5c6d7e8f9"
    const b = "csrf=ffffffffffffffffffffffffffffffff"
    expect(normalizeForDrift(a)).toBe(normalizeForDrift(b))
  })
})

describe("normalizeForDrift — leaves real content alone", () => {
  it("does not strip a year", () => {
    expect(normalizeForDrift("the FY2024 filing")).toContain("2024")
  })

  it("does not strip a percentage or a price", () => {
    const out = normalizeForDrift("improves safety by over 80% for $99/mo")
    expect(out).toContain("80%")
    expect(out).toContain("99")
  })

  it("does not collapse two genuinely different sentences", () => {
    expect(normalizeForDrift("FSD is supervised")).not.toBe(normalizeForDrift("FSD is unsupervised"))
  })

  it("does not strip a short count", () => {
    expect(normalizeForDrift("5 more crashes")).toContain("5")
  })

  it("does not collapse an unformatted claim number moving from 12 million to 99 million", () => {
    expect(driftHashOf("processed 12000000 transactions")).not.toBe(
      driftHashOf("processed 99000000 transactions"),
    )
  })

  it("does not strip an 8-digit number", () => {
    expect(normalizeForDrift("total of 12345678 units")).toContain("12345678")
  })

  it("does not strip a 9-digit number", () => {
    expect(normalizeForDrift("total of 123456789 units")).toContain("123456789")
  })

  it("does not strip an 11-digit number", () => {
    expect(normalizeForDrift("total of 12345678901 units")).toContain("12345678901")
  })

  it("does not strip a 12-digit number", () => {
    expect(normalizeForDrift("total of 123456789012 units")).toContain("123456789012")
  })

  it("does not strip a decimal fraction tail", () => {
    expect(normalizeForDrift("3.14159265358979")).toBe("3.14159265358979")
  })
})

describe("driftHashOf", () => {
  it("agrees for two texts differing only by a timestamp", () => {
    expect(driftHashOf("at 2026-09-10T00:00:00Z ok")).toBe(driftHashOf("at 2026-01-01T12:00:00Z ok"))
  })

  it("differs for two texts differing in prose", () => {
    expect(driftHashOf("ok")).not.toBe(driftHashOf("not ok"))
  })
})
